import type {
  DefiParams,
  DefiQueryParams,
} from 'features/defi/contexts/DefiManagerProvider/DefiCommon'
import { DefiAction } from 'features/defi/contexts/DefiManagerProvider/DefiCommon'
import { AnimatePresence } from 'framer-motion'
import { SlideTransition } from 'components/SlideTransition'
import { useFoxEth } from 'context/FoxEthProvider/FoxEthProvider'
import { useBrowserRouter } from 'hooks/useBrowserRouter/useBrowserRouter'

import { FoxFarmingDeposit } from './Deposit/FoxFarmingDeposit'
import { Claim } from './Overview/Claim/Claim'
import { FoxFarmingOverview } from './Overview/FoxFarmingOverview'
import { FoxFarmingWithdraw } from './Withdraw/FoxFarmingWithdraw'

export const FoxFarmingManager = () => {
  const { query } = useBrowserRouter<DefiQueryParams, DefiParams>()
  const { modal } = query
  const { farmingAccountId, setFarmingAccountId: handleFarmingAccountIdChange } = useFoxEth()

  return (
    <AnimatePresence exitBeforeEnter initial={false}>
      {modal === DefiAction.Overview && (
        <SlideTransition key={DefiAction.Overview}>
          <FoxFarmingOverview
            accountId={farmingAccountId}
            onAccountIdChange={handleFarmingAccountIdChange}
          />
        </SlideTransition>
      )}
      {modal === DefiAction.Deposit && (
        <SlideTransition key={DefiAction.Deposit}>
          <FoxFarmingDeposit
            accountId={farmingAccountId}
            onAccountIdChange={handleFarmingAccountIdChange}
          />
        </SlideTransition>
      )}
      {modal === DefiAction.Withdraw && (
        <SlideTransition key={DefiAction.Withdraw}>
          <FoxFarmingWithdraw
            accountId={farmingAccountId}
            onAccountIdChange={handleFarmingAccountIdChange}
          />
        </SlideTransition>
      )}
      {modal === DefiAction.Claim && (
        <SlideTransition key={DefiAction.Claim}>
          <Claim accountId={farmingAccountId} />
        </SlideTransition>
      )}
    </AnimatePresence>
  )
}
