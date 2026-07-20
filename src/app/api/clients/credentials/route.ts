import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

export async function GET() {
  try {
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { data: creds, error } = await supabase
      .from("client_credentials")
      .select("*");

    if (error) throw error;

    // Mask tokens for client-side consumption
    const maskedCreds = (creds || []).map((c) => ({
      ...c,
      meta_page_token_encrypted: "••••••••••••••••••••••••",
    }));

    return NextResponse.json({ success: true, credentials: maskedCreds });
  } catch (error: unknown) {
    console.error("Fetch client credentials error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
      return new NextResponse("Forbidden: Only Founders/Employees can manage credentials", { status: 403 });
    }

    const body = await request.json();
    const { clientId, metaPageToken, igBusinessId } = body;

    if (!clientId || !metaPageToken || !igBusinessId) {
      return NextResponse.json({ error: "Missing required credential parameters" }, { status: 400 });
    }

    // Encrypt the token
    const encryptedToken = encrypt(metaPageToken);

    // Upsert into client_credentials
    const { data, error } = await supabase
      .from("client_credentials")
      .upsert(
        {
          client_id: clientId,
          meta_page_token_encrypted: encryptedToken,
          ig_business_id: igBusinessId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      credentialId: data.id,
    });
  } catch (error: unknown) {
    console.error("Save client credentials error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
