exports.serverPath = process.env.POWERSHELL_SERVER_PATH || "";
exports.powershellPath = process.env.POWERSHELL_RUNTIME_PATH || "";
exports.liveSuite = exports.serverPath || process.env.REQUIRE_PSES ? describe : xdescribe;
