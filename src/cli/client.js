const http = require("http");
const path = require("path");

const wserver = require("@forfuture/wserver");

const configFilepath = process.argv[2];
if (!configFilepath) {
  console.error("usage: lw-client <path/to/config>");
  process.exit(1);
}

const config = require(path.resolve(configFilepath));
const websocket = new wserver.Client(config.remoteUrl);
const localApps = config.localApps || [];

websocket.on("request", function(websocketNotification) {
  const localApp = localApps.find(
    (a) => a.appSecret === websocketNotification.appSecret
  );
  if (!localApp) {
    return;
  }

  const onError = (error) => console.error(error);

  const appRequest = http.request(
    localApp.url,
    {
      headers: websocketNotification.webhookPayload.headers,
      method: "POST"
    },
    function(res) {
      res.on("error", onError);

      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        websocket
          .request("response", {
            notificationId: websocketNotification.notificationId,
            webhookPayload: {
              body: chunks.join(""),
              headers: res.headers,
              statusCode: res.statusCode
            }
          })
          .catch(onError);
      });
    }
  );
  appRequest.on("error", onError);
  appRequest.write(websocketNotification.webhookPayload.body);
  appRequest.end();
});

websocket.on("error", console.error);
