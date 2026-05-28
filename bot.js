const botApp = require('./src')

if (require.main === module) {
  botApp.start()
}

module.exports = botApp
