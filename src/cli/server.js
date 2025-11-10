const http = require("http");
const path = require("path");

const wserver = require("@forfuture/wserver");
const express = require("express");

// Constants.
const paths = {
    homepage: path.resolve(__dirname, "../../www/index.html"),
};
const pkg = require("../../package.json");

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
    return res.json({ version: pkg.version });
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
    return res.sendFile(paths.homepage);
});

// Start server.
server.listen(
    parseInt(process.env.HTTP_PORT || 8080, 10),
    process.env.HTTP_HOST || "0.0.0.0",
    () => console.log("[*] Server ready"),
);
