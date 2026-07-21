module.exports = {
  apps: [{
    name: 'hussle-terminal',
    script: 'src/index.js',
    cwd: 'C:/Users/ravir/Documents/Hussle/terminal/server',
    env_file: 'C:/Users/ravir/Documents/Hussle/terminal/server/.env',
    watch: false,
    restart_delay: 3000,
    max_restarts: 10,
  }]
};
