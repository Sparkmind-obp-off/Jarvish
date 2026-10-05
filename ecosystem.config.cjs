module.exports = {
  apps: [
    {
      name: "jarvish",
      script: "npx",
      args: "wrangler pages dev dist --ip 0.0.0.0 --port 3000 --d1 DB --persist-to cloudflare/.wrangler/state --binding JARVISH_ENV=development",
      cwd: "/home/user/webapp",
      watch: false,
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
