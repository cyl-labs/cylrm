module.exports = {
  apps: [
    {
      name: "crm",
      script: "npm",
      args: "start",
      cwd: "/root/crm",
      env: {
        NODE_ENV: "production",
        PORT: "3005",
      },
    },
    {
      name: "crm-worker",
      script: "worker/index.mjs",
      cwd: "/root/crm",
      node_args: "--env-file=.env",
    },
  ],
};
