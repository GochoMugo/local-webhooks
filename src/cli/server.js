const http = require("http");

const wserver = require("@forfuture/wserver");
const bodyParser = require("body-parser");
const express = require("express");

const app = express();
const server = http.Server(app);
const websocketServer = new wserver.Server(server, {
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

    websocketServer.notifyAll("request", {
      notificationId: id,
      appSecret: req.params.appSecret,
      webhookPayload: {
        body: chunks.join(""),
        headers: req.headers
      }
    });
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

app.post("/ping", bodyParser.json(), function(req, res) {
  return res.status(201).json({ pong: true });
});

server.listen(8985, "127.0.0.1");
