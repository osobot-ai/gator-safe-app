import { type Web3AuthContextConfig } from '@web3auth/modal/react'
import { WEB3AUTH_NETWORK, type Web3AuthOptions } from '@web3auth/modal'

const web3AuthOptions: Web3AuthOptions = {
  clientId: 'BPBZ2TqE24w4i58xfnvhVdsUdITRboguXoNgm_rV5rL8POt2gs3irhrfr1BTf3fsqOeNqdYPolDTL_ep7_uFgDg',
  web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
}

const web3AuthContextConfig: Web3AuthContextConfig = {
  web3AuthOptions,
}

export default web3AuthContextConfig
