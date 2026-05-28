function cleanText (text) {
  return String(text).replace(/\u00a7[0-9a-fk-or]/gi, '').trim()
}

function collectTextParts (value, parts = [], seen = new WeakSet()) {
  if (value === undefined || value === null) return parts

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectTextParts(JSON.parse(trimmed), parts, seen)
        return parts
      } catch {
        // Fall through and treat it as plain text.
      }
    }
    const cleaned = cleanText(value)
    if (cleaned) parts.push(cleaned)
    return parts
  }

  if (typeof value !== 'object') return parts
  if (seen.has(value)) return parts
  seen.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) collectTextParts(entry, parts, seen)
    return parts
  }

  if (Object.prototype.hasOwnProperty.call(value, 'text')) {
    collectTextParts(value.text, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'extra')) {
    collectTextParts(value.extra, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'with')) {
    collectTextParts(value.with, parts, seen)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'value')) {
    collectTextParts(value.value, parts, seen)
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'text') &&
      !Object.prototype.hasOwnProperty.call(value, 'extra') &&
      !Object.prototype.hasOwnProperty.call(value, 'with') &&
      !Object.prototype.hasOwnProperty.call(value, 'value')) {
    for (const entry of Object.values(value)) collectTextParts(entry, parts, seen)
  }

  return parts
}

function itemTexts (item) {
  if (!item) return []
  return collectTextParts([
    item.customName,
    item.displayName,
    item.name,
    item.nbt
  ])
}

module.exports = {
  cleanText,
  collectTextParts,
  itemTexts
}
