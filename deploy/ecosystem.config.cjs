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
      restart_delay: 2000,
      max_restarts: 10,
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
