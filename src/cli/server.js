const http = require("http");
const path = require("path");

const wserver = require("@forfuture/wserver");
const express = require("express");
const pg = require("pg");
const pgFormat = require("pg-format");

// Constants.
const paths = {
    assets: path.resolve(__dirname, "../../www/assets"),
    homepage: path.resolve(__dirname, "../../www/index.html"),
};
const pkg = require("../../package.json");

// Database connection.
const db = new pg.Client({
    database: process.env.PGDATABASE || "test",
    host: process.env.PGHOST || "localhost",
    password: process.env.PGPASSWORD || "password",
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || "postgres",
});

// Server instance.
const app = express();
const server = http.Server(app);
const websocketServer = new wserver.Server(server, {
    authenticateSocket(req) {
        const appSecrets = (req.query.appSecrets || "").split(",");
        return { appSecrets };
    },
    handleRequest(req) {
        switch (req.action) {
            case "response":
                endWebhookResponse(req);
                return { ok: true };
        }
    },
});

// Response objects for webhooks.
const webhookResponses = {};

// Latest notification ID for forwarding webhook request.
let websocketNotificationId = 0;

// Health endpoint.
// It's used in the container and the webpage.
app.get("/healthy", function (req, res) {
    console.log("[*] Healthcheck");
    return res.json({ count: websocketNotificationId, version: pkg.version });
});

// Submitting webhook requests.
app.all("/webhook/:appSecret", function (req, res) {
    console.log(`[*] New webhook request`);
    const chunks = [];

    // Collect request's data.
    req.on("data", (d) => chunks.push(d));

    // Once request data is complete, send notification via websocket.
    req.on("end", function () {
        const notificationId = ++websocketNotificationId;

        // Cache the response object.
        webhookResponses[notificationId] = res;

        // Send notification to sockets that provided this app secret.
        websocketServer.sockets
            .filter((socket) =>
                socket.profile.appSecrets.includes(req.params.appSecret),
            )
            .forEach((socket) =>
                socket
                    .notify("request", {
                        appSecret: req.params.appSecret,
                        notificationId,
                        webhookPayload: {
                            body: chunks.join(""),
                            headers: req.headers,
                            method: req.method,
                            query: req.query,
                        },
                    })
                    .catch(console.error),
            );
    });
});

// Finalize the webhook request with data from websocket.
function endWebhookResponse(websocketRequest) {
    const { notificationId, webhookPayload } = websocketRequest.args;
    console.log(`[*] Finalizing webhook request #${notificationId}`);

    // Find cached response object. If not found, ignore request.
    const response = webhookResponses[notificationId];
    if (!response) {
        return;
    }

    incrementRequestCount("webhook");

    // Remove response object from cache.
    delete webhookResponses[notificationId];

    // Send back response to original webhook request.
    return response
        .status(webhookPayload.statusCode)
        .set(webhookPayload.headers)
        .send(webhookPayload.body);
}

// Homepage.
app.get("/", function (req, res) {
    console.log("[*] Serving homepage");
    incrementRequestCount("homepage");
    return res.sendFile(paths.homepage);
});

// Assets
app.use("/assets", express.static(paths.assets));

async function main() {
    // Init database.
    try {
        await db.connect();
        await db.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'request_type'
            ) THEN
                CREATE TYPE request_type AS ENUM ('homepage', 'webhook');
            END IF;

            CREATE SEQUENCE IF NOT EXISTS homepage_request_count;
            CREATE SEQUENCE IF NOT EXISTS webhook_request_count;

            CREATE TABLE IF NOT EXISTS requests (
                count BIGINT NOT NULL,
                type request_type PRIMARY KEY
            );
        END$$;
`);

        // Restore state.
        const result = await db
            .query(`SELECT count FROM requests WHERE type = 'webhook'`)
            .catch(console.error);
        if (result?.rows.length) {
            websocketNotificationId = result.rows[0].count;
            console.log(
                "[*] Restored notification ID:",
                websocketNotificationId,
            );
        }
    } catch (error) {
        if (error.code !== "ECONNREFUSED") {
            throw error;
        }
    }

    // Start server.
    server.listen(
        parseInt(process.env.HTTP_PORT || 8080, 10),
        process.env.HTTP_HOST || "0.0.0.0",
        () => console.log("[*] Server ready"),
    );
}

async function incrementRequestCount(type) {
    const sequence_type = `${type}_request_count`;
    await db
        .query(
            pgFormat(
                `
          INSERT INTO requests (count, type)
              VALUES (NEXTVAL(%L), %L)
              ON CONFLICT (type) DO UPDATE SET
                  count = excluded.count;
`,
                sequence_type,
                type,
            ),
        )
        .catch(console.error);
}

main();
