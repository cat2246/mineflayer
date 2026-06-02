const { attachMaintenanceAutomation, runMaintenanceCycle } = require('../src/maintenanceAutomation')

if (process.argv.includes('--once')) {
  runMaintenanceCycle()
    .catch(err => {
      console.error(`Maintenance automation error: ${err.message}`)
      process.exitCode = 1
    })
} else {
  attachMaintenanceAutomation({ unrefTimer: false })
}
