import { Hono } from "hono";

type Env = {
  META_VERIFY_TOKEN: string;
  META_ACCESS_TOKEN: string;
  META_PHONE_NUMBER_ID: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
};

const app = new Hono<{ Bindings: Env }>();

// ================================
// WEBHOOK VERIFY
// ================================

app.get("/webhook", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (
    mode === "subscribe" &&
    token === c.env.META_VERIFY_TOKEN
  ) {
    return c.text(challenge || "");
  }

  return c.text("Forbidden", 403);
});

// ================================
// SEND WHATSAPP
// ================================

async function sendWhatsApp(
  env: Env,
  to: string,
  text: string,
) {
  const version =
    env.META_GRAPH_VERSION || "v26.0";

  const response = await fetch(
    `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${env.META_ACCESS_TOKEN}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text,
        },
      }),
    },
  );

  const result = await response.text();

  console.log(
    "WhatsApp API:",
    response.status,
    result,
  );

  if (!response.ok) {
    throw new Error(
      `WhatsApp API ${response.status}: ${result}`,
    );
  }
}

// ================================
// WEBHOOK POST
// ================================

app.post("/webhook", async (c) => {
  try {
    const body = await c.req.text();

    console.log(
      "WEBHOOK:",
      body,
    );

    const payload = JSON.parse(body);

    if (
      payload?.object !==
      "whatsapp_business_account"
    ) {
      return c.json({
        ok: true,
        ignored: true,
      });
    }

    const entries =
      Array.isArray(payload.entry)
        ? payload.entry
        : [];

    for (const entry of entries) {
      const changes =
        Array.isArray(entry?.changes)
          ? entry.changes
          : [];

      for (const change of changes) {
        const value = change?.value;

        if (!value) continue;

        const messages =
          Array.isArray(value.messages)
            ? value.messages
            : [];

        for (const message of messages) {
          if (
            message?.type !== "text"
          ) {
            continue;
          }

          const from =
            String(message.from || "");

          const text =
            String(
              message?.text?.body || "",
            );

          console.log(
            "FROM:",
            from,
            "TEXT:",
            text,
          );

          if (!from) continue;

          await sendWhatsApp(
            c.env,
            from,
            `✅ TEST OK\n\nوصلاتني الرسالة ديالك:\n"${text}"\n\nCloudflare + WhatsApp خدامين.`,
          );
        }
      }
    }

    return c.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "WEBHOOK ERROR:",
      error instanceof Error
        ? error.message
        : String(error),
    );

    return c.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});

// ================================
// ROOT
// ================================

app.get("/", (c) => {
  return c.json({
    ok: true,
    service:
      "WhatsApp TEST Worker",
  });
});

export default app;
