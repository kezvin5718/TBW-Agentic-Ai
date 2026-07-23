import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";

// GET: Webhook verification challenge for Meta Developer Portal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.log("WhatsApp webhook verified successfully.");
    return new Response(challenge, { status: 200 });
  }

  console.warn("WhatsApp webhook verification failed. Tokens mismatch.");
  return new Response("Forbidden", { status: 403 });
}

// POST: Handles inbound messages and simulator messages
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = createServiceRoleClient();

    let sender = "";
    let messageBody = "";
    let isVoice = false;
    let voiceMediaId = "";

    // 1. Check if it's a simulated message or a real Graph API message
    if (body.isSimulator) {
      sender = body.sender;
      messageBody = body.body;
      if (body.type === "audio") {
        isVoice = true;
        voiceMediaId = "mock-media-123";
      }
    } else {
      // Parse real Meta Webhook structure
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        // Could be a status update (sent, delivered, read) - ignore for now
        return NextResponse.json({ success: true, message: "Ignored status event" });
      }

      sender = message.from;
      if (message.type === "audio") {
        isVoice = true;
        voiceMediaId = message.audio?.id || "";
        messageBody = "";
      } else {
        messageBody = message.text?.body || "";
      }
    }

    if (!sender) {
      return NextResponse.json({ error: "Invalid message payload" }, { status: 400 });
    }

    // 1.2. Transcribe voice note if present
    if (isVoice) {
      try {
        if (body.isSimulator) {
          // Simulator passes the transcription directly inside body
          messageBody = body.body || "Are there any pending approvals?";
        } else {
          const { downloadWhatsAppMedia } = await import("@/lib/integrations/whatsapp");
          const { transcribeAudio } = await import("@/lib/integrations/stt");

          const { buffer, mimeType } = await downloadWhatsAppMedia(voiceMediaId);
          if (buffer.length > 0) {
            messageBody = await transcribeAudio(buffer, mimeType);
          } else {
            messageBody = "Simulated voice input transcription";
          }
        }
      } catch (err) {
        console.error("Failed to transcribe WhatsApp audio:", err);
        messageBody = "[Voice transcription failed]";
      }
    }

    if (!messageBody) {
      return NextResponse.json({ error: "Invalid empty message content" }, { status: 400 });
    }

    console.log(`Processing WhatsApp message from ${sender}: "${messageBody}"`);

    // 1.5. FOUNDER ASSISTANT ROUTING (Bron)
    const founderNum = process.env.FOUNDER_WHATSAPP_NUMBER;
    if (founderNum && sender === founderNum) {
      console.log(`Incoming message is from Founder (${sender}). Routing to Bron.`);
      
      const { data: pendingAction } = await supabase
        .from("jarvis_pending_actions")
        .select("*")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let jarvisReply = "";

      // Enforce safety rule: confirmations cannot be made via voice notes
      if (pendingAction) {
        const isConfirming = messageBody.trim().toLowerCase() === "yes" || messageBody.trim().toLowerCase() === "yes.";
        
        if (isConfirming) {
          if (isVoice) {
            jarvisReply = "❌ Action Blocked: Confirmation must be TYPED. Please type 'YES' as a text message to execute the action.";
          } else {
            const { execute_confirmed_action } = await import("@/lib/jarvis-tools");
            jarvisReply = await execute_confirmed_action(supabase, pendingAction.action_name, pendingAction.args, messageBody);
            
            await supabase
              .from("jarvis_pending_actions")
              .update({ status: "executed" })
              .eq("id", pendingAction.id);
          }
        } else {
          await supabase
            .from("jarvis_pending_actions")
            .update({ status: "cancelled" })
            .eq("id", pendingAction.id);

          const { processJarvisCommand } = await import("@/lib/jarvis");
          jarvisReply = await processJarvisCommand(supabase, messageBody);
        }
      } else {
        const { processJarvisCommand } = await import("@/lib/jarvis");
        jarvisReply = await processJarvisCommand(supabase, messageBody);
      }

      // Log voice interaction audit
      if (isVoice) {
        try {
          await supabase.from("voice_audit").insert({
            sender,
            audio_ref: voiceMediaId,
            transcription: messageBody,
            response: jarvisReply,
          });
        } catch (auditErr) {
          console.error("Failed to log voice interaction audit:", auditErr);
        }
      }

      await supabase.from("jarvis_chat_history").insert([
        { sender: "user", message: isVoice ? `🎙 [Voice Note]: ${messageBody}` : messageBody },
        { sender: "jarvis", message: jarvisReply }
      ]);

      const { sendWhatsAppText } = await import("@/lib/integrations/whatsapp");
      
      // Prefix speech transcription output
      const finalWhatsAppReply = isVoice 
        ? `🎙 You said: "${messageBody}"\n\n${jarvisReply}`
        : jarvisReply;

      await sendWhatsAppText({ to: sender, text: finalWhatsAppReply });

      // Handle optional WhatsApp Voice reply
      if (process.env.WHATSAPP_VOICE_REPLIES === "true") {
        try {
          const { synthesizeSpeech } = await import("@/lib/integrations/stt");
          const { uploadWhatsAppMedia, sendWhatsAppAudio } = await import("@/lib/integrations/whatsapp");

          const audioBuffer = await synthesizeSpeech(jarvisReply);
          if (audioBuffer.length > 0) {
            const mediaId = await uploadWhatsAppMedia(audioBuffer, "audio/aac");
            await sendWhatsAppAudio({ to: sender, mediaId });
          }
        } catch (voiceErr) {
          console.error("Failed to send WhatsApp synthesized voice reply:", voiceErr);
        }
      }

      return NextResponse.json({ success: true, routedTo: "jarvis", response: finalWhatsAppReply });
    }

    // 2. Lookup client matching the sender phone number
    let matchedClient = null;
    const { data: directMatch } = await supabase
      .from("clients")
      .select("id, name, ad_budget")
      .eq("whatsapp_group_id", sender)
      .maybeSingle();

    if (directMatch) {
      matchedClient = directMatch;
    } else {
      // Fetch all to inspect social_accounts JSON mappings
      const { data: allClients } = await supabase
        .from("clients")
        .select("id, name, social_accounts, ad_budget");

      matchedClient = allClients?.find(
        (c: { social_accounts: unknown }) => (c.social_accounts as Record<string, unknown> | null)?.whatsapp === sender
      ) || null;
    }

    if (!matchedClient) {
      console.warn(`No client matched for sender number: ${sender}`);
    }

    // 3. Classify message using LLM
    const systemPrompt = "You are the Client Relations Classifier for TBW Advertising. Classify client replies into exactly one of: approval, rejection, change_request, question, payment_related, angry, other. Output JSON.";

    const userMessage = `Classify this message from client: "${messageBody}"
    
Categories:
- "approval": client is approving a plan or asset (e.g. looks good, approved, go ahead, yes).
- "rejection": client is rejecting the plan/asset (e.g. start over, rejected, don't like it).
- "change_request": client asks to modify details (e.g. change color, focus more on Ready-to-eat).
- "question": client asks a general question (e.g. when will it be ready?).
- "payment_related": client mentions billing, invoicing, pricing.
- "angry": client shows high frustration or anger.
- "other": anything else.

Generate a JSON object: { "classification": "category" }`;

    const jsonSchema = {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: ["approval", "rejection", "change_request", "question", "payment_related", "angry", "other"],
        },
      },
      required: ["classification"],
    };

    let classification = "other";
    try {
      const aiResponse = await complete({
        model: MODEL_FAST,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        jsonSchema,
      });

      if (aiResponse) {
        classification = safeJsonParse(aiResponse, { classification: "other" }).classification || "other";
      }
    } catch (llmErr) {
      console.error("LLM classification failed, defaulting to other:", llmErr);
    }

    console.log(`Message classified as: ${classification}`);

    // 4. Log message in whatsapp_messages table
    const { data: loggedMsg, error: logErr } = await supabase
      .from("whatsapp_messages")
      .insert({
        client_id: matchedClient?.id || null,
        sender_number: sender,
        message_body: messageBody,
        message_type: "text",
        direction: "inbound",
        classification: classification,
      })
      .select()
      .single();

    if (logErr) {
      throw logErr;
    }

    const routingTrace: string[] = [];
    let draftResponse = null;

    // 5. Routing Actions based on classification
    if (matchedClient) {
      // Find the most recent pending approval for this client
      const { data: pendingApproval } = await supabase
        .from("approvals")
        .select("*")
        .eq("client_id", matchedClient.id)
        .eq("decision", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // A. Approval / Rejection resolution loop
      if (pendingApproval && ["approval", "rejection", "change_request"].includes(classification)) {
        const decision = classification === "approval" ? "approved" : "rejected";
        
        // Update approvals table
        const { error: appErr } = await supabase
          .from("approvals")
          .update({
            decision: decision,
            feedback_text: messageBody,
          })
          .eq("id", pendingApproval.id);

        if (appErr) console.error("Failed to update approval row:", appErr);
        routingTrace.push(`Resolved pending approval (${pendingApproval.id}) as ${decision}`);

        // Update target entity status
        const { entity_type, entity_id } = pendingApproval;
        if (entity_type === "plan") {
          const planStatus = decision === "approved" ? "approved" : "rejected";
          await supabase.from("monthly_plans").update({ status: planStatus }).eq("id", entity_id);
          routingTrace.push(`Updated monthly plan (${entity_id}) status to ${planStatus}`);

          if (planStatus === "approved") {
            const { generateTasksForPlan } = await import("@/lib/tasks-utils");
            const res = await generateTasksForPlan(entity_id);
            if (res.success) {
              routingTrace.push(res.message || "Auto-created production tasks!");
            } else {
              console.error("Auto-task creation failed:", res.error);
            }
          } else {
            // Rejection / Change request: Append feedback to brand_brain feedback_log
            const { data: brain } = await supabase
              .from("brand_brain")
              .select("feedback_log")
              .eq("client_id", matchedClient.id)
              .maybeSingle();

            if (brain) {
              const currentLogs = (brain.feedback_log as Array<Record<string, unknown>> | null) || [];
              const updatedLogs = [
                {
                  date: new Date().toISOString(),
                  sender: "client",
                  comment: `Rejection feedback: ${messageBody}`,
                },
                ...currentLogs,
              ];

              await supabase
                .from("brand_brain")
                .update({ feedback_log: updatedLogs })
                .eq("client_id", matchedClient.id);

              routingTrace.push("Appended client revision notes to brand_brain feedback log.");
            }
          }
        } else if (entity_type === "creative") {
          const creativeStatus = decision === "approved" ? "approved" : "rejected";
          await supabase.from("creatives").update({ client_approval: creativeStatus }).eq("id", entity_id);
          routingTrace.push(`Updated creative asset (${entity_id}) client_approval status to ${creativeStatus}`);

          // Fetch creative and linked parent task
          const { data: creative } = await supabase
            .from("creatives")
            .select("*, tasks(*)")
            .eq("id", entity_id)
            .single();

          if (creative && creative.tasks) {
            const task = creative.tasks;
            const taskMeta = (task.metadata || {}) as Record<string, unknown>;

            if (creativeStatus === "approved") {
              // Task status set to done (completed)
              await supabase.from("tasks").update({ status: "done" }).eq("id", task.id);
              
              // Log client review timeline event
              await supabase.from("creative_timeline").insert({
                creative_id: entity_id,
                event_type: "client_review",
                status_from: "sent_to_client",
                status_to: "scheduled",
                actor_role: "client",
                notes: `Client approved creative draft via WhatsApp. Message: "${messageBody}"`,
              });
            } else {
              // Re-open task to todo for edits
              await supabase.from("tasks").update({
                status: "todo",
                metadata: {
                  ...taskMeta,
                  client_feedback: messageBody,
                }
              }).eq("id", task.id);

              // Log client review timeline event
              await supabase.from("creative_timeline").insert({
                creative_id: entity_id,
                event_type: "client_review",
                status_from: "sent_to_client",
                status_to: "needs_revision",
                actor_role: "client",
                notes: `Client requested changes via WhatsApp: "${messageBody}"`,
              });

              // Append feedback to brand_brain feedback_log
              const { data: brain } = await supabase
                .from("brand_brain")
                .select("feedback_log")
                .eq("client_id", pendingApproval.client_id)
                .maybeSingle();

              const logs = (brain?.feedback_log as Array<Record<string, unknown>> | null) || [];
              const newLog = {
                date: new Date().toISOString(),
                sender: "client",
                comment: `Creative rejection feedback: "${messageBody}"`,
              };
              await supabase
                .from("brand_brain")
                .update({ feedback_log: [newLog, ...logs] })
                .eq("client_id", pendingApproval.client_id);

              routingTrace.push("Appended client creative rejection feedback to brand_brain feedback log.");
            }
          }
        }
      }

      // B. Draft a response for questions
      if (classification === "question") {
        const { data: brain } = await supabase
          .from("brand_brain")
          .select("brand_brief")
          .eq("client_id", matchedClient.id)
          .maybeSingle();

        const draftPrompt = `Draft a warm, polite response under 60 words for the client's question: "${messageBody}". 
        Brand Brief context: "${brain?.brand_brief || "Pristine ad operations agency in India."}". Return raw draft text only.`;

        try {
          const draftText = await complete({
            model: MODEL_FAST,
            system: "You are the Client Liaison Bot. Write client communications.",
            messages: [{ role: "user", content: draftPrompt }],
          });

          if (draftText) {
            draftResponse = draftText.trim();
            // Save draft response to the message record
            await supabase
              .from("whatsapp_messages")
              .update({ reply_draft: draftResponse })
              .eq("id", loggedMsg.id);
            
            routingTrace.push("Drafted response and saved to message history");
          }
        } catch (draftErr) {
          console.error("Drafting response failed:", draftErr);
        }
      }

      // C. High priority alert on Angry
      if (classification === "angry") {
        routingTrace.push("ALERT: Angry client detected! Alert triggered to founder inbox. Auto-reply disabled.");
        // Append critical alert directly to client brand brain feedback_log
        const { data: brain } = await supabase
          .from("brand_brain")
          .select("feedback_log")
          .eq("client_id", matchedClient.id)
          .maybeSingle();

        if (brain) {
          const currentLogs = brain.feedback_log || [];
          const updatedLogs = [
            {
              date: new Date().toISOString(),
              sender: "client",
              comment: `⚠️ WhatsApp Escalation Alert: ${messageBody}`,
            },
            ...currentLogs,
          ];

          await supabase
            .from("brand_brain")
            .update({ feedback_log: updatedLogs })
            .eq("client_id", matchedClient.id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Message processed successfully",
      classification,
      matchedClient: matchedClient?.name || "None",
      routingTrace,
      draftResponse,
    });
  } catch (error: unknown) {
    console.error("WhatsApp Webhook Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
