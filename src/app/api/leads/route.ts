import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function GET() {
  const supabase = await createClient();

  // Verify session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads });
}

export async function POST(request: Request) {
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
    return new NextResponse("Forbidden: Only Founders/Employees can manage CRM leads", { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, companyName, contactPerson, email, phone, status, notes, leadId } = body;

    // Action 1: Create prospect lead
    if (action === "create") {
      if (!companyName) {
        return NextResponse.json({ error: "Missing company name parameter" }, { status: 400 });
      }

      const { data: lead, error: saveErr } = await supabase
        .from("leads")
        .insert({
          company_name: companyName,
          contact_person: contactPerson || "",
          email: email || "",
          phone: phone || "",
          status: status || "new",
          notes: notes || "",
        })
        .select()
        .single();

      if (saveErr) throw saveErr;

      return NextResponse.json({ success: true, lead });
    }

    // Action 2: Update prospect status (drag & drop trigger)
    if (action === "updateStatus") {
      if (!leadId || !status) {
        return NextResponse.json({ error: "Missing parameters for update" }, { status: 400 });
      }

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status })
        .eq("id", leadId);

      if (updateErr) throw updateErr;

      return NextResponse.json({ success: true });
    }

    // Action 3: Fire follow-up WhatsApp reminder alert to founder
    if (action === "reminder") {
      if (!leadId) {
        return NextResponse.json({ error: "Missing leadId parameter" }, { status: 400 });
      }

      // Fetch lead
      const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (!lead) return NextResponse.json({ error: "Prospect lead not found" }, { status: 404 });

      // Fetch Founder phone
      const { data: founderProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("role", "founder")
        .limit(1)
        .maybeSingle();
      const founderPhone = founderProfile?.phone || "9999999999";

      const reminderText = `🔔 CRM Follow-up Reminder:\n` +
        `Prospect Name: *${lead.contact_person || "N/A"}*\n` +
        `Company: *${lead.company_name}*\n` +
        `Current Status: ${lead.status.toUpperCase()}\n` +
        `Phone: ${lead.phone || "N/A"}\n` +
        `Notes: ${lead.notes || "None"}`;

      await sendWhatsAppText({
        to: founderPhone,
        text: reminderText,
      });

      return NextResponse.json({ success: true, message: "WhatsApp follow-up reminder sent to founder." });
    }

    return NextResponse.json({ error: "Invalid action parameter" }, { status: 400 });

  } catch (err: unknown) {
    console.error("Leads API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
