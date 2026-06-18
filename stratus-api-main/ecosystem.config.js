module.exports = {
  apps: [
    {
      name: "stratus-api",
      script: "./api.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      },
      error_file: "logs/api.err.log",
      out_file: "logs/api.out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_memory_restart: "512M",
      watch: false,
      ignore_watch: ["node_modules", "logs"],
    }
  ]
};
