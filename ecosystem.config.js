module.exports = {
  apps: [
    // API Server - handles HTTP requests and adds jobs to queues
    {
      name: "bullmq-server",
      script: "./dist/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/server-error.log",
      out_file: "./logs/server-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "500M",
    },
    // Workers - process jobs from queues
    {
      name: "bullmq-workers",
      script: "./dist/workers.js",
      instances: 2, // Run 2 worker instances for better throughput
      exec_mode: "cluster", // Use cluster mode for multiple instances
      watch: false,
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/workers-error.log",
      out_file: "./logs/workers-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "800M",
      restart_delay: 4000,
    },
  ],
};
