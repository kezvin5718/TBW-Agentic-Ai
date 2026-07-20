import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params;
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const body = await request.json();
    const { replyText } = body;

    if (!replyText || !replyText.trim()) {
      return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
    }

    // 1. Fetch message details
    const { data: message, error: msgErr } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (msgErr || !message) {
      return NextResponse.json({ error: "WhatsApp Message not found" }, { status: 404 });
    }

    // 2. Dispatch message using integrations module
    await sendWhatsAppText({
      to: message.sender_number,
      text: replyText,
    });

    // 3. Mark message metadata showing it was answered and resolved
    const currentMeta = message.metadata || {};
    const updatedMeta = {
      ...currentMeta,
      replied_at: new Date().toISOString(),
      replied_by: user.id,
      final_reply_sent: replyText,
    };

    const { error: updateErr } = await supabase
      .from("whatsapp_messages")
      .update({
        metadata: updatedMeta,
        reply_draft: null, // Clear draft since it is resolved
      })
      .eq("id", messageId);

    if (updateErr) {
      throw updateErr;
    }

    // 4. Log the outgoing message as an outbound message in history
    await supabase.from("whatsapp_messages").insert({
      client_id: message.client_id,
      sender_number: message.sender_number,
      message_body: replyText,
      message_type: "text",
      direction: "outbound",
      metadata: { replied_to_message_id: messageId },
    });

    return NextResponse.json({
      success: true,
      sentText: replyText,
    });
  } catch (error: unknown) {
    console.error("Send Reply Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
