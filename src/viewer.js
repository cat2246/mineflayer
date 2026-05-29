const net = require('net')
const { buildViewerOptions } = require('./config')

function loadMineflayerViewer () {
  return require('prismarine-viewer').mineflayer
}

function isPortAvailable (port) {
  return new Promise(resolve => {
    const server = net.createServer()

    server.once('error', err => {
      resolve(err.code !== 'EADDRINUSE')
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port)
  })
}

function closeViewer (bot) {
  if (!bot?.viewer || bot.viewerClosed) return false
  bot.viewerClosed = true
  if (typeof bot.viewer.close === 'function') {
    bot.viewer.close()
  }
  return true
}

async function startViewer (bot, mineflayerViewer = loadMineflayerViewer(), options = buildViewerOptions()) {
  const { isPortAvailable: checkPort = isPortAvailable, ...viewerOptions } = options
  const portAvailable = await checkPort(viewerOptions.port)
  if (!portAvailable) {
    console.log(`Viewer port ${viewerOptions.port} is already in use; skipping Prismarine Viewer.`)
    return null
  }

  mineflayerViewer(bot, viewerOptions)
  const viewer = bot.viewer
  if (typeof bot.once === 'function') {
    bot.once('end', () => closeViewer(bot))
  }
  console.log(`Viewer running at http://localhost:${viewerOptions.port}`)
  return viewer
}

module.exports = {
  closeViewer,
  isPortAvailable,
  loadMineflayerViewer,
  startViewer
}
