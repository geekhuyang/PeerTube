import * as url from 'url'
import { ActivityPubActor } from '../../../shared/models/activitypub/activitypub-actor'
import { isRemoteAccountValid } from '../../helpers/custom-validators/activitypub/account'
import { logger } from '../../helpers/logger'
import { doRequest } from '../../helpers/requests'
import { ACTIVITY_PUB } from '../../initializers/constants'
import { database as db } from '../../initializers/database'

async function getOrCreateAccount (accountUrl: string) {
  let account = await db.Account.loadByUrl(accountUrl)

  // We don't have this account in our database, fetch it on remote
  if (!account) {
    const res = await fetchRemoteAccountAndCreateServer(accountUrl)
    if (res === undefined) throw new Error('Cannot fetch remote account.')

    // Save our new account in database
    account = await res.account.save()
  }

  return account
}

async function fetchRemoteAccountAndCreateServer (accountUrl: string) {
  const options = {
    uri: accountUrl,
    method: 'GET',
    headers: {
      'Accept': ACTIVITY_PUB.ACCEPT_HEADER
    }
  }

  logger.info('Fetching remote account %s.', accountUrl)

  let requestResult
  try {
    requestResult = await doRequest(options)
  } catch (err) {
    logger.warn('Cannot fetch remote account %s.', accountUrl, err)
    return undefined
  }

  const accountJSON: ActivityPubActor = JSON.parse(requestResult.body)
  if (isRemoteAccountValid(accountJSON) === false) {
    logger.debug('Remote account JSON is not valid.', { accountJSON })
    return undefined
  }

  const followersCount = await fetchAccountCount(accountJSON.followers)
  const followingCount = await fetchAccountCount(accountJSON.following)

  const account = db.Account.build({
    uuid: accountJSON.uuid,
    name: accountJSON.preferredUsername,
    url: accountJSON.url,
    publicKey: accountJSON.publicKey.publicKeyPem,
    privateKey: null,
    followersCount: followersCount,
    followingCount: followingCount,
    inboxUrl: accountJSON.inbox,
    outboxUrl: accountJSON.outbox,
    sharedInboxUrl: accountJSON.endpoints.sharedInbox,
    followersUrl: accountJSON.followers,
    followingUrl: accountJSON.following
  })

  const accountHost = url.parse(account.url).host
  const serverOptions = {
    where: {
      host: accountHost
    },
    defaults: {
      host: accountHost
    }
  }
  const [ server ] = await db.Server.findOrCreate(serverOptions)
  account.set('serverId', server.id)

  return { account, server }
}

export {
  getOrCreateAccount,
  fetchRemoteAccountAndCreateServer
}

// ---------------------------------------------------------------------------

async function fetchAccountCount (url: string) {
  const options = {
    uri: url,
    method: 'GET'
  }

  let requestResult
  try {
    requestResult = await doRequest(options)
  } catch (err) {
    logger.warn('Cannot fetch remote account count %s.', url, err)
    return undefined
  }

  return requestResult.totalItems ? requestResult.totalItems : 0
}
