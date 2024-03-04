const http = require("http");
const path = require("path")

const wserver = require("@forfuture/wserver");
const bodyParser = require("body-parser");
const express = require("express");

const app = express();
const paths = {
  homepage: path.resolve(__dirname, "../../www/index.html"),
};
const server = http.Server(app);
const websocketServer = new wserver.Server(server, {
  authenticateSocket(req) {
    const appSecrets = (req.query.appSecrets || "").split(",");
    return { appSecrets };
  },
  handleRequest(req) {
    switch (req.action) {
      case "response":
        endResponse(req);
        return { ok: true };
    }
  }
});
const webhookResponses = {};
let websocketNotificationId = 0;

app.post("/webhook/:appSecret", function(req, res) {
  const id = ++websocketNotificationId;

  const chunks = [];
  req.on("data", (d) => chunks.push(d));

  req.on("end", function() {
    webhookResponses[id] = res;

    const sockets = websocketServer.sockets.filter((socket) =>
      socket.profile.appSecrets.includes(req.params.appSecret)
    );
    Promise.all(
      sockets.map((socket) =>
        socket.notify("request", {
          notificationId: id,
          appSecret: req.params.appSecret,
          webhookPayload: {
            body: chunks.join(""),
            headers: req.headers
          }
        })
      )
    );
  });
});

function endResponse(websocketRequest) {
  const response = webhookResponses[websocketRequest.args.notificationId];
  if (!response) {
    return;
  }
  delete webhookResponses[websocketRequest.args.notificationId];

  const { body, headers, statusCode } = websocketRequest.args.webhookPayload;

  response
    .status(statusCode)
    .set(headers)
    .send(body);
}

app.get("/", function(req, res) {
  return res.sendFile(paths.homepage);
});

app.post("/ping", bodyParser.json(), function(req, res) {
  return res.status(201).json({ pong: true });
});

server.listen(
  parseInt(process.env.HTTP_PORT || 8080, 10),
  process.env.HTTP_HOST || "0.0.0.0"
);
