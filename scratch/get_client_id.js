const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://xqhygmdznuecoxdvcmyl.supabase.co";
const supabaseKey = "sb_publishable__x36hrUOD3KEv5eElXdvGA_8dSUm_Ev";

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name");

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Clients List:", JSON.stringify(data));
  }
}

test();
