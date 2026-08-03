local RESOURCE_NAME = GetCurrentResourceName()
local endpoint = GetConvar('donut_webbridge_url', '')
local secret = GetConvar('donut_webbridge_secret', '')
local serverId = GetConvar('donut_webbridge_server_id', 'main')
local heartbeatMs = math.max(5000, GetConvarInt('donut_webbridge_interval_ms', 10000))
local requestInFlight = false
local queued = false
local warnedMissingConfig = false

local function getMaxPlayers()
    local configured = GetConvarInt('sv_maxClients', 0)
    if configured > 0 then return configured end
    return GetConvarInt('sv_maxclients', 250)
end

local function buildPayload()
    local players = GetPlayers()
    local instances = {}

    for i = 1, #players do
        local playerId = players[i]
        local bucket = GetPlayerRoutingBucket(playerId)
        local key = tostring(bucket)
        instances[key] = (instances[key] or 0) + 1
    end

    return {
        serverId = serverId,
        timestamp = os.time() * 1000,
        totalPlayers = #players,
        maxPlayers = getMaxPlayers(),
        instances = instances
    }
end

local function sendHeartbeat()
    if requestInFlight then
        queued = true
        return
    end

    if endpoint == '' or secret == '' then
        if not warnedMissingConfig then
            warnedMissingConfig = true
            print(('[%s] Missing donut_webbridge_url or donut_webbridge_secret convar. Heartbeats are disabled.'):format(RESOURCE_NAME))
        end
        return
    end

    requestInFlight = true
    local payload = json.encode(buildPayload())

    PerformHttpRequest(endpoint, function(statusCode, responseBody)
        requestInFlight = false

        if statusCode < 200 or statusCode >= 300 then
            print(('[%s] Website heartbeat failed with HTTP %s: %s'):format(RESOURCE_NAME, statusCode, responseBody or 'no response'))
        end

        if queued then
            queued = false
            SetTimeout(1000, sendHeartbeat)
        end
    end, 'POST', payload, {
        ['Content-Type'] = 'application/json',
        ['Accept'] = 'application/json',
        ['Authorization'] = ('Bearer %s'):format(secret),
        ['User-Agent'] = ('%s/1.0.0'):format(RESOURCE_NAME)
    })
end

local function queueHeartbeat(delay)
    SetTimeout(delay or 750, sendHeartbeat)
end

CreateThread(function()
    Wait(1500)
    sendHeartbeat()

    while true do
        Wait(heartbeatMs)
        sendHeartbeat()
    end
end)

AddEventHandler('playerJoining', function()
    queueHeartbeat(1500)
end)

AddEventHandler('playerDropped', function()
    queueHeartbeat(750)
end)

AddEventHandler('onPlayerBucketChange', function()
    queueHeartbeat(500)
end)

AddEventHandler('onResourceStart', function(resourceName)
    if resourceName == RESOURCE_NAME then
        endpoint = GetConvar('donut_webbridge_url', '')
        secret = GetConvar('donut_webbridge_secret', '')
        serverId = GetConvar('donut_webbridge_server_id', 'main')
        heartbeatMs = math.max(5000, GetConvarInt('donut_webbridge_interval_ms', 10000))
        queueHeartbeat(1000)
    end
end)

exports('SendHeartbeat', sendHeartbeat)
