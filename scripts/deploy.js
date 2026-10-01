// emp-tracker deploy: builds, uploads, restarts. Run: node scripts/deploy.js [--skip-build]
// SSH key lookup (first hit wins): --key <path>, $DEPLOY_KEY, scripts/emp_key.pem
// (git-ignored — copy your .pem there once), %TEMP%/opencode/emp_deploy_key.pem,
// ../cutting-ticket-tracker/server.md (embedded key, same server).
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const HOST = "3.227.229.246";
const USER = "ubuntu";
const DOMAIN = "employeetracker.predestinenyc.com";
const REMOTE_FE = "/var/www/emp-tracker-frontend/dist";
const REMOTE_BE = "/var/www/emp-tracker-backend";
const SERVICE = "emp-tracker-backend.service";
const rootDir = path.resolve(__dirname, "..");

const ts = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const log = (m) => console.log(`  [${ts()}] ${m}`);
const fail = (m) => { console.error(`  [${ts()}] FATAL: ${m}`); process.exit(1); };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}`);
  return (r.stdout || "").trim();
}

function findKey() {
  const ai = process.argv.indexOf("--key");
  const cands = [
    ai > -1 && process.argv[ai + 1],
    process.env.DEPLOY_KEY,
    path.join(__dirname, "emp_key.pem"),
    path.join(tmpdir(), "opencode", "emp_deploy_key.pem"),
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  // fallback: extract from sibling project's server.md
  const md = path.resolve(rootDir, "..", "cutting-ticket-tracker", "server.md");
  if (existsSync(md)) {
    const m = readFileSync(md, "utf8").match(/-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]+?-----END OPENSSH PRIVATE KEY-----/);
    if (m) {
      const out = path.join(tmpdir(), "opencode", "emp_deploy_key.pem");
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, m[0].trim() + "\n");
      return out;
    }
  }
  fail("no SSH key found (use --key <pem>, $DEPLOY_KEY, or scripts/emp_key.pem)");
}

const KEY = findKey();
const who = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : `${process.env.USERNAME}`;
const acl = spawnSync("cmd", ["/c", `icacls "${KEY}" /inheritance:r /grant:r ${who}:F >nul`], { stdio: "pipe", encoding: "utf8" });
if (acl.status !== 0) log("warning: could not lock key file permissions, continuing anyway...");
const sshBase = ["-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", `${USER}@${HOST}`];
const ssh = (script) => sh("ssh", [...sshBase, `echo ${Buffer.from(script).toString("base64")} | base64 -d | bash -s`]);

async function main() {
  console.log("\n  === emp-tracker deploy -> " + DOMAIN + " ===\n");
  log("key: " + KEY);

  if (!process.argv.includes("--skip-build")) {
    log("building client...");
    sh("npm", ["run", "build"], { cwd: path.join(rootDir, "client"), shell: true });
    log("verifying server build...");
    sh("npm", ["run", "build"], { cwd: path.join(rootDir, "server"), shell: true });
  } else if (!existsSync(path.join(rootDir, "client", "dist", "index.html"))) {
    fail("client/dist missing — run without --skip-build first");
  }

  const tmp = path.join(tmpdir(), "opencode");
  const feTar = path.join(tmp, "emp-frontend.tar.gz");
  const beTar = path.join(tmp, "emp-backend.tar.gz");
  log("packing...");
  sh("tar.exe", ["-czf", feTar, "index.html", "assets"], { cwd: path.join(rootDir, "client", "dist") });
  sh("tar.exe", ["-czf", beTar, "--exclude=node_modules", "--exclude=dist", "--exclude=.env",
    "package.json", "package-lock.json", "tsconfig.json", "src"], { cwd: path.join(rootDir, "server") });

  log("uploading...");
  sh("scp", ["-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", feTar, beTar, `${USER}@${HOST}:/home/ubuntu/`]);

  log("deploying on server (existing .env is preserved)...");
  ssh(`
set -e
rm -rf ${REMOTE_FE}; mkdir -p ${REMOTE_FE}
tar -xzf /home/ubuntu/emp-frontend.tar.gz -C ${REMOTE_FE}
rm -rf ${REMOTE_BE}/src ${REMOTE_BE}/dist
tar -xzf /home/ubuntu/emp-backend.tar.gz -C ${REMOTE_BE}
cd ${REMOTE_BE}
npm install --no-audit --no-fund 2>&1 | tail -n 1
npm run build 2>&1 | tail -n 1
DEBPASS=$(sudo grep -m1 password /etc/mysql/debian.cnf | awk '{print $3}')
DATABASE_URL="mysql://debian-sys-maint:\${DEBPASS}@127.0.0.1:3306/emp_tracker" npm run migrate 2>&1 | tail -n 4
sudo systemctl restart ${SERVICE}
sleep 3
systemctl is-active ${SERVICE}
curl -s http://127.0.0.1:5005/api/health; echo
rm -f /home/ubuntu/emp-frontend.tar.gz /home/ubuntu/emp-backend.tar.gz
echo DEPLOY_OK
  `);

  log("public check...");
  const pub = sh("curl", ["-s", `http://${DOMAIN}/api/health`], { quiet: true });
  if (!pub.includes('"status":"ok"')) fail("public health check failed: " + pub);
  log("public API: " + pub);
  console.log("\n  DONE -> http://" + DOMAIN + "/\n");
}

main();
