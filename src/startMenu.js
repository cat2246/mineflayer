const readline = require('readline')
const { buildBotOptionsFromProfileSelection, createProfileStore, DEFAULT_AUTH_ROOT, normalizePort } = require('./profileStore')

function getMainMenuOptions (data) {
  const options = ['Create new bot']
  if ((data?.bots || []).length > 0) options.push('Select a bot')
  return options
}

function getServerMenuOptions (data) {
  const options = ['Create a new server']
  if ((data?.servers || []).length > 0) options.push('Select a server')
  return options
}

function formatServerLabel (serverProfile) {
  return `${serverProfile.host}:${serverProfile.port}`
}

function defaultPromptFactory (input, output) {
  const rl = readline.createInterface({ input, output })
  const prompt = question => new Promise(resolve => {
    rl.question(question, answer => resolve(answer))
  })
  prompt.close = () => rl.close()
  return prompt
}

function writeMenu (output, title, options) {
  output.write(`\n${title}\n`)
  options.forEach((option, index) => {
    output.write(`${index + 1}) ${option}\n`)
  })
}

async function promptChoice (options) {
  const output = options.output
  const prompt = options.prompt
  const choices = options.choices

  while (true) {
    writeMenu(output, options.title, choices.map(choice => choice.label))
    const answer = (await prompt('Choose an option: ')).trim()
    const selectedIndex = Number.parseInt(answer, 10) - 1
    if (choices[selectedIndex]) return choices[selectedIndex].value
    output.write('Invalid option. Try again.\n')
  }
}

async function promptText (prompt, output, question) {
  while (true) {
    const answer = (await prompt(question)).trim()
    if (answer) return answer
    output.write('Value cannot be empty.\n')
  }
}

async function createBotProfileFromMenu (store, prompt, output) {
  const auth = await promptChoice({
    choices: [
      { label: 'Offline bot', value: 'offline' },
      { label: 'Online bot', value: 'microsoft' }
    ],
    output,
    prompt,
    title: 'Create Bot'
  })
  const username = await promptText(prompt, output, auth === 'microsoft' ? 'Minecraft email/username: ' : 'Bot username: ')
  return store.createBotProfile({ username, auth })
}

async function createServerProfileFromMenu (store, prompt, output) {
  const host = await promptText(prompt, output, 'Server IP/host: ')
  const portAnswer = (await prompt('Server port (default 25565): ')).trim()
  return store.createServerProfile({
    host,
    port: portAnswer ? normalizePort(portAnswer) : undefined
  })
}

async function selectBotProfile (store, prompt, output) {
  const data = store.load()
  return promptChoice({
    choices: data.bots.map(bot => ({
      label: `${bot.username} (${bot.auth})`,
      value: bot
    })),
    output,
    prompt,
    title: 'Select Bot'
  })
}

async function selectServerProfile (store, prompt, output) {
  const data = store.load()
  return promptChoice({
    choices: data.servers.map(server => ({
      label: formatServerLabel(server),
      value: server
    })),
    output,
    prompt,
    title: 'Select Server'
  })
}

async function chooseServerForBot (store, prompt, output, botProfile) {
  while (true) {
    const data = store.load()
    const action = await promptChoice({
      choices: getServerMenuOptions(data).map(label => ({ label, value: label })),
      output,
      prompt,
      title: 'Server Menu'
    })

    if (action === 'Create a new server') {
      await createServerProfileFromMenu(store, prompt, output)
      continue
    }

    const serverProfile = await selectServerProfile(store, prompt, output)
    let serverLoginPassword = store.getServerLoginPassword(botProfile.id, serverProfile.id)
    if (!serverLoginPassword) {
      serverLoginPassword = await promptText(prompt, output, 'Server login password for this bot/server: ')
      store.setServerLoginPassword(botProfile.id, serverProfile.id, serverLoginPassword)
    }

    return {
      botProfile,
      serverLoginPassword,
      serverProfile
    }
  }
}

async function startInteractiveMenu (options = {}) {
  const output = options.output || process.stdout
  const store = options.store || createProfileStore()
  const prompt = options.prompt || defaultPromptFactory(options.input || process.stdin, output)
  const createBot = options.createBot

  if (typeof createBot !== 'function') {
    throw new Error('Missing createBot function for interactive startup.')
  }

  try {
    while (true) {
      const data = store.load()
      const action = await promptChoice({
        choices: getMainMenuOptions(data).map(label => ({ label, value: label })),
        output,
        prompt,
        title: 'Main Menu'
      })

      if (action === 'Create new bot') {
        await createBotProfileFromMenu(store, prompt, output)
        continue
      }

      const botProfile = await selectBotProfile(store, prompt, output)
      const selected = await chooseServerForBot(store, prompt, output, botProfile)
      const botOptions = buildBotOptionsFromProfileSelection({
        authRoot: options.authRoot || DEFAULT_AUTH_ROOT,
        botProfile: selected.botProfile,
        env: options.env || process.env,
        serverProfile: selected.serverProfile
      })
      const runtimeOptions = {
        logTerminal: options.logTerminal,
        serverLabel: formatServerLabel(selected.serverProfile),
        serverLoginPassword: selected.serverLoginPassword
      }
      if (!Object.prototype.hasOwnProperty.call(options, 'logTerminal')) delete runtimeOptions.logTerminal
      return createBot(botOptions, runtimeOptions)
    }
  } finally {
    if (typeof prompt.close === 'function') prompt.close()
  }
}

module.exports = {
  createBotProfileFromMenu,
  createServerProfileFromMenu,
  formatServerLabel,
  getMainMenuOptions,
  getServerMenuOptions,
  startInteractiveMenu
}
