const { buildViewerOptions } = require('./config')

function loadMineflayerViewer () {
  return require('prismarine-viewer').mineflayer
}

function startViewer (bot, mineflayerViewer = loadMineflayerViewer(), options = buildViewerOptions()) {
  const viewer = mineflayerViewer(bot, options)
  console.log(`Viewer running at http://localhost:${options.port}`)
  return viewer
}

module.exports = {
  loadMineflayerViewer,
  startViewer
}
