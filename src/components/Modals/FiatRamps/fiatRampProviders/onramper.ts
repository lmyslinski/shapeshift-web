import { adapters, AssetId } from '@shapeshiftoss/caip'
import axios from 'axios'
import { getConfig } from 'config'
import { head, uniqBy } from 'lodash'
import { logger } from 'lib/logger'

import { FiatRampAsset } from '../FiatRampsCommon'

const moduleLogger = logger.child({
  namespace: ['Modals', 'FiatRamps', 'fiatRampProviders', 'OnRamper'],
})

// Non-exhaustive required types definition. Full reference: https://github.com/onramper/widget/blob/master/package/src/ApiContext/api/types/gateways.ts
type OnRamperGatewaysResponse = {
  gateways: GatewayItem[]
  icons: TokenIconMap
}

type TokenIconMap = {
  [key: string]: IconGatewaysResponse
}

type Currency = {
  code: string
  id: string
  network?: string
  displayName?: string
}

type IconGatewaysResponse = {
  name: string
  icon: string
  symbol?: string
}

type GatewayItem = {
  identifier: string
  cryptoCurrencies: Currency[]
}

export const getOnRamperAssets = async (): Promise<FiatRampAsset[]> => {
  const data = await (async () => {
    try {
      const baseUrl = getConfig().REACT_APP_ONRAMPER_API_URL
      const apiKey = getConfig().REACT_APP_ONRAMPER_API_KEY
      const { data } = await axios.get<OnRamperGatewaysResponse>(
        `${baseUrl}gateways?includeIcons=true`,
        {
          headers: {
            Authorization: `Basic ${apiKey}`,
          },
        },
      )

      return data
    } catch (e) {
      moduleLogger.error(e, 'Failed to fetch assets')
    }
  })()

  if (!data) return []

  const fiatRampAssets = convertOnRamperDataToFiatRampAsset(data)
  return fiatRampAssets
}

const convertOnRamperDataToFiatRampAsset = (
  response: OnRamperGatewaysResponse,
): FiatRampAsset[] => {
  const allCoins = response.gateways
    .flatMap(gateway => gateway.cryptoCurrencies)
    .map(currency => toFiatRampAsset(currency, response.icons))
    .filter(assetOpt => assetOpt !== undefined) as FiatRampAsset[]

  const uniqueCoins = uniqBy(allCoins, 'assetId')
  return uniqueCoins
}

const toFiatRampAsset = (currency: Currency, icons: TokenIconMap): FiatRampAsset | undefined => {
  const assetId = adapters.onRamperTokenIdToAssetId(currency.code)
  if (assetId) {
    return {
      name: currency.displayName || '',
      assetId,
      symbol: currency.code,
      imageUrl: icons[currency.code].icon,
      fiatRampCoinId: currency.id,
    }
  }
  return undefined
}

export const createOnRamperUrl = (
  assetId: AssetId,
  address: string,
  currentUrl: string,
): string => {
  const onRamperSymbols = adapters.assetIdToOnRamperTokenList(assetId)
  if (!onRamperSymbols) throw new Error('Asset not supported by OnRamper')

  const baseUrl = getConfig().REACT_APP_ONRAMPER_WIDGET_URL
  const apiKey = getConfig().REACT_APP_ONRAMPER_API_KEY

  const params = new URLSearchParams()
  const defaultCrypto = head(onRamperSymbols)!!

  params.set('apiKey', apiKey)
  params.set('defaultCrypto', defaultCrypto)
  params.set('onlyCryptos', onRamperSymbols.join(','))
  params.set('wallets', `${defaultCrypto}:${address}`)
  params.set('isAddressEditable', 'false')
  // we don't support selling via OnRamper because there's no way to open the popup directly on the Sell tab
  params.set('supportSell', 'false')
  // because we're dark as well
  params.set('darkMode', 'true')
  params.set('redirectURL', currentUrl)

  return `${baseUrl.toString()}?${params.toString()}`
}
