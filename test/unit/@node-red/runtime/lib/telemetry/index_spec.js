const should = require("should");
const NR_TEST_UTILS = require("nr-test-utils");

const telemetryApi = NR_TEST_UTILS.require("@node-red/runtime/lib/telemetry/index");

describe("telemetry", function() {

    afterEach(function () {
        telemetryApi.stop()
        messages = []
    })

    let messages = []

    function getMockRuntime(settings) {
        return {
            settings: {
                get: key => { return settings[key] },
                set: (key, value) => { settings[key] = value },
                available: () => true,
            },
            log: {
                debug: (msg) => { messages.push(msg)}
            }
        }
    }

    // Principles to test:
    // - No settings at all; disable telemetry
    // - Runtime settings only; do what it says
    // - User settings take precedence over runtime settings

    it('Disables telemetry with no settings present', function () {
        telemetryApi.init(getMockRuntime({}))
        messages.should.have.length(0)
        // Returns undefined as we don't know either way
        ;(telemetryApi.isEnabled() === undefined).should.be.true()
    })
    it('Runtime settings - enable', function () {
        // Enabled in runtime settings
        telemetryApi.init(getMockRuntime({
            telemetry: { enabled: true }
        }))
        telemetryApi.isEnabled().should.be.true()
        messages.should.have.length(1)
        ;/Telemetry enabled/.test(messages[0]).should.be.true()
    })
    it('Runtime settings - disable', function () {
        telemetryApi.init(getMockRuntime({
            telemetry: { enabled: false },
        }))
        // Returns false, not undefined
        telemetryApi.isEnabled().should.be.false()
        messages.should.have.length(0)
    })

    it('User settings - enable overrides runtime settings', function () {
        telemetryApi.init(getMockRuntime({
            telemetry: { enabled: false },
            telemetryEnabled: true
        }))
        telemetryApi.isEnabled().should.be.true()
        messages.should.have.length(1)
        ;/Telemetry enabled/.test(messages[0]).should.be.true()
    })

    it('User settings - disable overrides runtime settings', function () {
        telemetryApi.init(getMockRuntime({
            telemetry: { enabled: true },
            telemetryEnabled: false
        }))
        telemetryApi.isEnabled().should.be.false()
        messages.should.have.length(0)
    })
    
    it('Can enable/disable telemetry', function () {
        const settings = {}
        telemetryApi.init(getMockRuntime(settings))
        ;(telemetryApi.isEnabled() === undefined).should.be.true()

        telemetryApi.enable()

        telemetryApi.isEnabled().should.be.true()
        messages.should.have.length(1)
        ;/Telemetry enabled/.test(messages[0]).should.be.true()
        settings.should.have.property('telemetryEnabled', true)

        telemetryApi.disable()

        telemetryApi.isEnabled().should.be.false()
        messages.should.have.length(2)
        ;/Telemetry disabled/.test(messages[1]).should.be.true()
        settings.should.have.property('telemetryEnabled', false)

    })

    describe('locked by the administrator (telemetry.locked)', function () {
        let warnings
        function getLockedRuntime(settings) {
            warnings = []
            const rt = getMockRuntime(settings)
            rt.log.warn = msg => { warnings.push(msg) }
            rt.log._ = (key, opts) => key
            return rt
        }
        it('Locked - settings disable overrides user enable', function () {
            telemetryApi.init(getLockedRuntime({
                telemetry: { enabled: false, locked: true },
                telemetryEnabled: true
            }))
            telemetryApi.isEnabled().should.be.false()
            telemetryApi.isLocked().should.be.true()
            // Schedule not started
            messages.should.have.length(0)
        })
        it('Locked - settings enable overrides user disable', function () {
            telemetryApi.init(getLockedRuntime({
                telemetry: { enabled: true, locked: true },
                telemetryEnabled: false
            }))
            telemetryApi.isEnabled().should.be.true()
            messages.should.have.length(1)
            ;/Telemetry enabled/.test(messages[0]).should.be.true()
        })
        it('Locked without enabled - disabled', function () {
            telemetryApi.init(getLockedRuntime({
                telemetry: { locked: true },
                telemetryEnabled: true
            }))
            telemetryApi.isEnabled().should.be.false()
            messages.should.have.length(0)
        })
        it('Locked - enable() does not start schedule or store the value', function () {
            const settings = { telemetry: { enabled: false, locked: true } }
            telemetryApi.init(getLockedRuntime(settings))
            telemetryApi.enable()
            telemetryApi.isEnabled().should.be.false()
            settings.should.not.have.property('telemetryEnabled')
            messages.filter(m => /Telemetry enabled/.test(m)).should.have.length(0)
        })
        it('Locked - disable() does not stop schedule or store the value', function () {
            const settings = { telemetry: { enabled: true, locked: true }, telemetryEnabled: true }
            telemetryApi.init(getLockedRuntime(settings))
            telemetryApi.disable()
            telemetryApi.isEnabled().should.be.true()
            settings.should.have.property('telemetryEnabled', true)
            messages.filter(m => /Telemetry disabled/.test(m)).should.have.length(0)
        })
        it('Locked keeps the saved user choice for when the lock is removed', function () {
            const settings = { telemetry: { enabled: false, locked: true }, telemetryEnabled: true }
            telemetryApi.init(getLockedRuntime(settings))
            telemetryApi.isEnabled().should.be.false()
            telemetryApi.stop()
            settings.telemetry = { enabled: false }
            telemetryApi.init(getLockedRuntime(settings))
            telemetryApi.isEnabled().should.be.true()
        })
        it('Not locked - user settings override (unchanged)', function () {
            telemetryApi.init(getLockedRuntime({
                telemetry: { enabled: false },
                telemetryEnabled: true
            }))
            telemetryApi.isLocked().should.be.false()
            telemetryApi.isEnabled().should.be.true()
            warnings.should.have.length(0)
        })
        it('settings enabled false without lock - user enable wins (R-09)', function () {
            // NODE_RED_DISABLE_TELEMETRY / --no-telemetry only set telemetry.enabled = false
            telemetryApi.init(getLockedRuntime({
                telemetry: { enabled: false },
                telemetryEnabled: true
            }))
            telemetryApi.isEnabled().should.be.true()
            telemetryApi.isLocked().should.be.false()
        })
        it('Non-boolean locked is treated as false with a warning', function () {
            telemetryApi.init(getLockedRuntime({
                telemetry: { enabled: false, locked: "yes" },
                telemetryEnabled: true
            }))
            telemetryApi.isLocked().should.be.false()
            telemetryApi.isEnabled().should.be.true()
            warnings.should.have.length(1)
        })
    })
})