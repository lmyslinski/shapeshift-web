import { useToast } from '@chakra-ui/react'
import type { AccountId } from '@shapeshiftoss/caip'
import { toAssetId } from '@shapeshiftoss/caip'
import { supportsETH } from '@shapeshiftoss/hdwallet-core'
import { ssRouterContractAddress } from '@shapeshiftoss/investor-idle'
import { Approve as ReusableApprove } from 'features/defi/components/Approve/Approve'
import { ApprovePreFooter } from 'features/defi/components/Approve/ApprovePreFooter'
import type { DepositValues } from 'features/defi/components/Deposit/Deposit'
import type {
  DefiParams,
  DefiQueryParams,
} from 'features/defi/contexts/DefiManagerProvider/DefiCommon'
import { DefiAction, DefiStep } from 'features/defi/contexts/DefiManagerProvider/DefiCommon'
import { getIdleInvestor } from 'features/defi/contexts/IdleProvider/idleInvestorSingleton'
import { canCoverTxFees } from 'features/defi/helpers/utils'
import { useCallback, useContext, useMemo } from 'react'
import { useTranslate } from 'react-polyglot'
import type { StepComponentProps } from 'components/DeFi/components/Steps'
import { getChainAdapterManager } from 'context/PluginProvider/chainAdapterSingleton'
import { useBrowserRouter } from 'hooks/useBrowserRouter/useBrowserRouter'
import { useWallet } from 'hooks/useWallet/useWallet'
import { bnOrZero } from 'lib/bignumber/bignumber'
import { logger } from 'lib/logger'
import { poll } from 'lib/poll/poll'
import { isSome } from 'lib/utils'
import {
  selectAssetById,
  selectBIP44ParamsByAccountId,
  selectMarketDataById,
} from 'state/slices/selectors'
import { useAppSelector } from 'state/store'

import { IdleDepositActionType } from '../DepositCommon'
import { DepositContext } from '../DepositContext'

type IdleApproveProps = StepComponentProps & { accountId: AccountId | undefined }

const moduleLogger = logger.child({ namespace: ['IdleDeposit:Approve'] })

export const Approve: React.FC<IdleApproveProps> = ({ accountId, onNext }) => {
  const idleInvestor = useMemo(() => getIdleInvestor(), [])
  const { state, dispatch } = useContext(DepositContext)
  const estimatedGasCrypto = state?.approve.estimatedGasCrypto
  const translate = useTranslate()
  const { query } = useBrowserRouter<DefiQueryParams, DefiParams>()
  const { chainId, assetReference } = query
  const opportunity = state?.opportunity
  const chainAdapter = getChainAdapterManager().get(chainId)

  const accountFilter = useMemo(() => ({ accountId }), [accountId])
  const bip44Params = useAppSelector(state => selectBIP44ParamsByAccountId(state, accountFilter))

  const assetNamespace = 'erc20'
  const assetId = toAssetId({ chainId, assetNamespace, assetReference })
  const feeAssetId = chainAdapter?.getFeeAssetId()
  const asset = useAppSelector(state => selectAssetById(state, assetId))
  const feeAsset = useAppSelector(state => selectAssetById(state, feeAssetId ?? ''))
  const feeMarketData = useAppSelector(state => selectMarketDataById(state, feeAssetId ?? ''))

  // user info
  const { state: walletState } = useWallet()

  // notify
  const toast = useToast()

  const getDepositGasEstimate = useCallback(
    async (deposit: DepositValues): Promise<string | undefined> => {
      if (!(state?.userAddress && opportunity && assetReference && idleInvestor)) return
      try {
        const idleOpportunity = await idleInvestor.findByOpportunityId(
          opportunity.positionAsset.assetId ?? '',
        )
        if (!idleOpportunity) throw new Error('No opportunity')
        const preparedTx = await idleOpportunity.prepareDeposit({
          amount: bnOrZero(deposit.cryptoAmount).times(`1e+${asset.precision}`).integerValue(),
          address: state.userAddress,
        })
        // TODO: Figure out a better way for the safety factor
        return bnOrZero(preparedTx.gasPrice)
          .times(preparedTx.estimatedGas)
          .integerValue()
          .toString()
      } catch (error) {
        moduleLogger.error(
          { fn: 'getDepositGasEstimate', error },
          'Error getting deposit gas estimate',
        )
        toast({
          position: 'top-right',
          description: translate('common.somethingWentWrongBody'),
          title: translate('common.somethingWentWrong'),
          status: 'error',
        })
      }
    },
    [
      state?.userAddress,
      opportunity,
      assetReference,
      idleInvestor,
      asset.precision,
      toast,
      translate,
    ],
  )

  const handleApprove = useCallback(async () => {
    if (
      !(
        dispatch &&
        bip44Params &&
        assetReference &&
        state?.userAddress &&
        walletState.wallet &&
        supportsETH(walletState.wallet) &&
        opportunity &&
        chainAdapter
      )
    )
      return

    try {
      dispatch({ type: IdleDepositActionType.SET_LOADING, payload: true })
      const idleOpportunity = await idleInvestor.findByOpportunityId(
        opportunity.positionAsset.assetId ?? '',
      )
      if (!idleOpportunity) throw new Error('No opportunity')
      const tx = await idleOpportunity.prepareApprove(state.userAddress)
      await idleOpportunity.signAndBroadcast({
        wallet: walletState.wallet,
        tx,
        // TODO: allow user to choose fee priority
        feePriority: undefined,
        bip44Params,
      })
      const address = state.userAddress
      await poll({
        fn: () => idleOpportunity.allowance(address),
        validate: (result: string) => {
          const allowance = bnOrZero(result).div(`1e+${asset.precision}`)
          return bnOrZero(allowance).gte(state.deposit.cryptoAmount)
        },
        interval: 15000,
        maxAttempts: 30,
      })
      // Get deposit gas estimate
      const estimatedGasCrypto = await getDepositGasEstimate(state.deposit)
      if (!estimatedGasCrypto) return
      dispatch({
        type: IdleDepositActionType.SET_DEPOSIT,
        payload: { estimatedGasCrypto },
      })

      onNext(DefiStep.Confirm)
    } catch (error) {
      moduleLogger.error({ fn: 'handleApprove', error }, 'Error getting approval gas estimate')
      toast({
        position: 'top-right',
        description: translate('common.transactionFailedBody'),
        title: translate('common.transactionFailed'),
        status: 'error',
      })
    } finally {
      dispatch({ type: IdleDepositActionType.SET_LOADING, payload: false })
    }
  }, [
    dispatch,
    assetReference,
    state?.userAddress,
    state?.deposit,
    walletState.wallet,
    opportunity,
    chainAdapter,
    idleInvestor,
    bip44Params,
    getDepositGasEstimate,
    onNext,
    asset.precision,
    toast,
    translate,
  ])

  const hasEnoughBalanceForGas = useMemo(
    () =>
      isSome(accountId) &&
      isSome(estimatedGasCrypto) &&
      canCoverTxFees({
        feeAsset,
        estimatedGasCrypto,
        accountId,
      }),
    [accountId, feeAsset, estimatedGasCrypto],
  )

  const preFooter = useMemo(
    () => (
      <ApprovePreFooter
        accountId={accountId}
        action={DefiAction.Deposit}
        feeAsset={feeAsset}
        estimatedGasCrypto={estimatedGasCrypto}
      />
    ),
    [accountId, feeAsset, estimatedGasCrypto],
  )

  if (!state || !dispatch || !estimatedGasCrypto) return null

  return (
    <ReusableApprove
      asset={asset}
      feeAsset={feeAsset}
      cryptoEstimatedGasFee={bnOrZero(state.approve.estimatedGasCrypto)
        .div(`1e+${feeAsset.precision}`)
        .toFixed(5)}
      disabled={!hasEnoughBalanceForGas}
      fiatEstimatedGasFee={bnOrZero(state.approve.estimatedGasCrypto)
        .div(`1e+${feeAsset.precision}`)
        .times(feeMarketData.price)
        .toFixed(2)}
      loading={state.loading}
      loadingText={translate('common.approveOnWallet')}
      preFooter={preFooter}
      providerIcon={asset.icon}
      learnMoreLink='https://shapeshift.zendesk.com/hc/en-us/articles/360018501700'
      onCancel={() => onNext(DefiStep.Info)}
      onConfirm={handleApprove}
      contractAddress={ssRouterContractAddress}
    />
  )
}
