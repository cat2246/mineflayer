const fs = require('fs')
const path = require('path')

const RECIPE_KNOWLEDGE_VERSION = 1
const VALID_STATUSES = new Set(['draft', 'verified', 'blocked', 'failed'])

function compactText (value, fallback = '', maxLength = 160) {
  return String(value || fallback)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function recipeKey (item) {
  return compactText(item, '', 80).toLowerCase()
}

function normalizePlanStep (step) {
  if (!step || typeof step !== 'object') return null

  const item = recipeKey(step.item)
  if (!item) return null

  const count = Math.max(1, Math.min(Number.parseInt(step.count || 1, 10) || 1, 64))
  const requires = Array.isArray(step.requires)
    ? [...new Set(step.requires.map(value => recipeKey(value)).filter(Boolean))].slice(0, 16)
    : []

  return {
    tool: compactText(step.tool, 'craft_item', 80),
    item,
    count,
    requires
  }
}

function normalizeRecipeRecord (record) {
  if (!record || typeof record !== 'object') return null

  const item = recipeKey(record.item)
  if (!item) return null

  const status = VALID_STATUSES.has(record.status) ? record.status : 'draft'
  const plan = Array.isArray(record.plan)
    ? record.plan.map(normalizePlanStep).filter(Boolean).slice(0, 32)
    : []
  const missingIngredients = Array.isArray(record.missingIngredients)
    ? [...new Set(record.missingIngredients.map(value => recipeKey(value)).filter(Boolean))].slice(0, 32)
    : []

  return {
    item,
    status,
    minecraftVersion: compactText(record.minecraftVersion, '', 40),
    plan,
    missingIngredients,
    lastVerifiedAt: Number.isFinite(record.lastVerifiedAt) ? record.lastVerifiedAt : 0
  }
}

function emptyRecipeKnowledge () {
  return {
    version: RECIPE_KNOWLEDGE_VERSION,
    recipes: {}
  }
}

function normalizeRecipeKnowledge (knowledge) {
  const normalized = emptyRecipeKnowledge()
  if (!knowledge || typeof knowledge !== 'object' || !knowledge.recipes || typeof knowledge.recipes !== 'object') {
    return normalized
  }

  for (const value of Object.values(knowledge.recipes)) {
    const record = normalizeRecipeRecord(value)
    if (record) normalized.recipes[record.item] = record
  }

  return normalized
}

function readRecipeKnowledge (options = {}) {
  const filePath = options.learnedRecipesPath
  if (!filePath || !fs.existsSync(filePath)) return emptyRecipeKnowledge()

  try {
    return normalizeRecipeKnowledge(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch (err) {
    return emptyRecipeKnowledge()
  }
}

function writeRecipeKnowledge (knowledge, options = {}) {
  const filePath = options.learnedRecipesPath
  if (!filePath) return normalizeRecipeKnowledge(knowledge)

  const normalized = normalizeRecipeKnowledge(knowledge)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}

function upsertLearnedRecipe (record, options = {}) {
  if (!record || typeof record !== 'object') return null

  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const normalizedRecord = normalizeRecipeRecord({
    ...record,
    lastVerifiedAt: record.lastVerifiedAt ?? now
  })
  if (!normalizedRecord) return null

  const knowledge = readRecipeKnowledge(options)
  knowledge.recipes[normalizedRecord.item] = normalizedRecord
  writeRecipeKnowledge(knowledge, options)
  return normalizedRecord
}

function summarizeRecipeKnowledge (options = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(options.limit || 8, 10) || 8, 20))

  return Object.values(readRecipeKnowledge(options).recipes)
    .sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt)
    .slice(0, limit)
    .map(record => ({
      item: record.item,
      status: record.status,
      missingIngredients: record.missingIngredients,
      steps: record.plan.length
    }))
}

module.exports = {
  emptyRecipeKnowledge,
  normalizeRecipeKnowledge,
  readRecipeKnowledge,
  RECIPE_KNOWLEDGE_VERSION,
  summarizeRecipeKnowledge,
  upsertLearnedRecipe,
  writeRecipeKnowledge
}
