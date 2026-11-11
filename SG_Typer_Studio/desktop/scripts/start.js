// Runs the app from its sources. Some tools, built on Electron themselves, leave a variable
// behind that would run Electron as plain Node.

const { spawn } = require("child_process");
const path = require("path");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve(__dirname, ".."), ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code || 0));
