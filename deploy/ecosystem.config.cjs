// PM2 process config for ServiceHub.
//
// CRITICAL: instances=1, exec_mode="fork".
// The app keeps WebSocket presence, ticket viewers, admin chat viewers,
// ticket-email cooldowns, and the wsClients set in process memory.
// Cluster mode would split that state across workers and break presence.
// Do NOT change to cluster mode.

module.exports = {
  apps: [
    {
      name: "servicehub",
      script: "./dist/index.cjs",
      cwd: "/opt/servicehub",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      kill_timeout: 10000, // give graceful shutdown 10s before SIGKILL
      wait_ready: false,
      listen_timeout: 15000,
      // Exponential backoff between crash-restarts (caps around ~15s). Unlike
      // a fixed restart_delay + small max_restarts, this keeps retrying far
      // longer: each boot attempt itself retries the DB for ~5 min, which
      // exceeds min_uptime and resets PM2's unstable-restart counter, so a
      // multi-minute DB outage should never leave the app
      // permanently stopped (the Aug 2026 502: a 5s postgres restart during
      // unattended upgrades exhausted 10 restarts and the site stayed down
      // for 18 hours). The app also retries DB connects at boot for ~5 min.
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      min_uptime: "30s",
      env_file: "/opt/servicehub/.env",
      env: {
        NODE_ENV: "production",
      },
      out_file: "/var/log/servicehub/out.log",
      error_file: "/var/log/servicehub/err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
