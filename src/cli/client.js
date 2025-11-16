const http = require("http");
const path = require("path");

const wserver = require("@forfuture/wserver");
const Ajv = require("ajv");
const addAjvFormats = require("ajv-formats");
const chalk = require("chalk").default;
const { program } = require("commander");

// CLI arguments parsing.
const defaultConfigFilepath = path.join(process.cwd(), "./lw.json");
program
    .version(require("../../package.json").version)
    .argument(
        "[path/to/config]",
        "Path to configuration file",
        defaultConfigFilepath,
    )
    .usage("[options] <path/to/config>")
    .option("-v, --verbose", "Log payload to stdout", false)
    .parse();
const configFilepath = program.args[0] || defaultConfigFilepath;
const opts = program.opts();

// Load and validate configuration.
const ajv = new Ajv();
addAjvFormats(ajv);
let config;
try {
    config = Object.assign(
        {
            localApps: [],
            remoteUrl: "https://lw.gocho.live",
        },
        require(path.resolve(configFilepath)),
    );
} catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
        throw new Error(`Configuration file not found: ${configFilepath}`);
    }
    throw error;
}
const isConfigValid = ajv.validate(
    require("../../schemas/config-schema.json"),
    config,
);
if (!isConfigValid) {
    console.error(ajv.errors);
    throw new Error("Invalid configuration");
}

// Constants.
const webhookUrl = `${config.remoteUrl}/webhook`;
const websocketUrl = `${config.remoteUrl}/ws`;

// Request index; used for display purposes only.
let requestIndex = 0;

// Open websocket client.
const websocket = new wserver.Client(
    `${websocketUrl}?appSecrets=${config.localApps.map((a) => a.secret).join(",")}`,
);
const onError = (error) => console.error(error);

// Websocket errors.
websocket.on("error", onError);

// When websocket has opened.
websocket.on("open", function () {
    console.log(
        `\n\nYou are now connected to the Internet.\n\nHere are your webhook URLs:`,
    );
    config.localApps.forEach(function (app, index) {
        const url = chalk.green(`${webhookUrl}/${app.secret}`);
        console.log(`    ${index + 1}. ${app.name} ⇒\t${url}`);
    });
    console.log(`\nYour local apps are ready for webhook requests.\n`);
});

// Listen for webhook requests.
websocket.on("request", function (websocketNotification) {
    const { appSecret, notificationId, webhookPayload } = websocketNotification;

    // Find the local app. If not found, ignore notification.
    const localApp = config.localApps.find((a) => a.secret === appSecret);
    if (!localApp) {
        return;
    }

    // Log request to notification.
    const name = chalk.green(localApp.name);
    const timestamp = new Date().toISOString();
    console.log(`${++requestIndex}. ${timestamp} [#${notificationId}] ${name}`);
    if (opts.verbose) {
        console.log(
            chalk.bgGray(
                "webhook payload: " + JSON.stringify(webhookPayload, null, 2),
            ),
        );
    }

    let qs = "";
    const queryKeys = webhookPayload.query && Object.keys(webhookPayload.query);
    if (queryKeys?.length) {
        qs =
            "?" +
            queryKeys
                .map((key) => `${key}=${webhookPayload.query[key]}`)
                .join("&");
    }

    const appRequest = http.request(
        `${localApp.url}${qs}`,
        {
            headers: webhookPayload.headers,
            method: webhookPayload.method || "POST",
        },
        function (res) {
            res.on("error", onError);

            // Collect data from local app.
            const chunks = [];
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                chunks.push(chunk);
            });

            // Once complete data is received from local app,
            // send response to websocket server.
            res.on("end", () => {
                websocket
                    .request("response", {
                        notificationId,
                        webhookPayload: {
                            body: chunks.join(""),
                            headers: res.headers,
                            statusCode: res.statusCode,
                        },
                    })
                    .catch(onError);
            });
        },
    );

    // If sending request returned an error, send
    // an error response to websocket server.
    appRequest.on("error", (error) => {
        console.error("Request error:", error);
        websocket
            .request("response", {
                notificationId,
                webhookPayload: {
                    body: error.message,
                    statusCode: 500,
                },
            })
            .catch(onError);
    });

    // Send webhook request data to local app.
    if (webhookPayload.body) {
        appRequest.write(webhookPayload.body);
    }
    appRequest.end();
});
