import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processJarvisCommand } from "@/lib/jarvis";
import { execute_confirmed_action } from "@/lib/jarvis-tools";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Verify Authentication & Founder Role
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "founder") {
      return NextResponse.json({ error: "Access denied. Founder only." }, { status: 403 });
    }

    // 2. Parse payload
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: "Missing message body" }, { status: 400 });
    }

    console.log(`Bron chat endpoint processing: "${message}"`);

    // 3. Check for active pending actions
    const { data: pendingAction } = await supabase
      .from("jarvis_pending_actions")
      .select("*")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let jarvisReply = "";

    if (pendingAction) {
      if (message.trim().toLowerCase() === "yes" || message.trim().toLowerCase() === "yes.") {
        // Execute the confirmed action
        jarvisReply = await execute_confirmed_action(supabase, pendingAction.action_name, pendingAction.args, message);
        
        // Mark as executed
        await supabase
          .from("jarvis_pending_actions")
          .update({ status: "executed" })
          .eq("id", pendingAction.id);
      } else {
        // Cancel the pending action
        await supabase
          .from("jarvis_pending_actions")
          .update({ status: "cancelled" })
          .eq("id", pendingAction.id);

        // Run Bron normally
        jarvisReply = await processJarvisCommand(supabase, message);
      }
    } else {
      // Run Bron normally
      jarvisReply = await processJarvisCommand(supabase, message);
    }

    // 4. Save Chat History
    await supabase.from("jarvis_chat_history").insert([
      { sender: "user", message },
      { sender: "jarvis", message: jarvisReply },
    ]);

    return NextResponse.json({
      success: true,
      reply: jarvisReply,
    });
  } catch (error: unknown) {
    console.error("Bron API Handler Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Verify Founder Role
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "founder") {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    // Get chat history
    const { data: history } = await supabase
      .from("jarvis_chat_history")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100);

    return NextResponse.json({
      success: true,
      history: history || [],
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
