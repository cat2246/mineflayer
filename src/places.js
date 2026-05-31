const fs = require('fs')
const path = require('path')
const { PLACE_COORDINATES_PATH } = require('./config')

const PLACES_VERSION = 1

function placesPath (options = {}) {
  if (options.placesPath === false) return null
  return options.placesPath || PLACE_COORDINATES_PATH
}

function clonePosition (position) {
  if (!position) return null
  return {
    x: position.x,
    y: position.y,
    z: position.z
  }
}

function dimensionName (bot, options = {}) {
  return String(options.dimension || bot?.game?.dimension || 'overworld')
}

function emptyPlaces () {
  return {
    version: PLACES_VERSION,
    places: {}
  }
}

function normalizePlaces (places) {
  if (!places || typeof places !== 'object') return emptyPlaces()
  return {
    version: PLACES_VERSION,
    places: places.places && typeof places.places === 'object' ? places.places : {}
  }
}

function readPlaces (options = {}) {
  const filePath = placesPath(options)
  if (!filePath || !fs.existsSync(filePath)) return emptyPlaces()

  try {
    return normalizePlaces(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (err) {
    return emptyPlaces()
  }
}

function writePlaces (places, options = {}) {
  const filePath = placesPath(options)
  if (!filePath) return

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(normalizePlaces(places), null, 2)}\n`)
  } catch (err) {
    // Place memory is advisory; bot behavior should continue if the file is unavailable.
  }
}

function rememberPlaceCoordinates (bot, name, position, options = {}) {
  const placePosition = clonePosition(position)
  if (!name || !placePosition) return null

  const places = readPlaces(options)
  places.places[name] = {
    dimension: dimensionName(bot, options),
    position: placePosition,
    updatedAt: Date.now()
  }
  writePlaces(places, options)
  return places.places[name]
}

function readPlaceCoordinates (name, options = {}) {
  return readPlaces(options).places[name] || null
}

module.exports = {
  readPlaceCoordinates,
  readPlaces,
  rememberPlaceCoordinates,
  writePlaces
}
