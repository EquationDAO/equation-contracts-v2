// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../IEquationContractsV1Minimum.sol";

/// @notice The contract implementation is used to be compatible with the farming rewards, referral fees,
/// staking rewards and architect rewards of Equation Contracts V1
/// @dev In order for this contract to work properly, it needs to be registered as a plugin of
/// Equation Contracts V1's Router, and it needs to be registered as a collector of Equation
/// Contracts V1's IFarmRewardDistributorV2
abstract contract EquationContractsV1RewardCollectorCompatibility {
    IRouter public immutable routerV1;
    IFarmRewardDistributorV2 public immutable distributorV2;
    IEFC public immutable EFC;

    error InvalidCaller(address caller, address requiredCaller);

    constructor(IRouter _routerV1, IFarmRewardDistributorV2 _distributorV2) {
        routerV1 = _routerV1;
        EFC = _routerV1.EFC();
        distributorV2 = _distributorV2;
    }

    function collectContractsV1ReferralFeeBatch(
        IPool[] calldata _pools,
        uint256[] calldata _referralTokens
    ) external virtual returns (uint256 amount) {
        _validateOwner(_referralTokens);

        IPool pool;
        uint256 poolsLen = _pools.length;
        uint256 tokensLen;
        for (uint256 i; i < poolsLen; ++i) {
            (pool, tokensLen) = (_pools[i], _referralTokens.length);
            for (uint256 j; j < tokensLen; ++j)
                amount += routerV1.pluginCollectReferralFee(pool, _referralTokens[j], address(this));
        }
    }

    function collectContractsV1FarmLiquidityRewardBatch(
        IPool[] calldata _pools
    ) external virtual returns (uint256 rewardDebt) {
        rewardDebt = routerV1.pluginCollectFarmLiquidityRewardBatch(_pools, msg.sender, address(this));
    }

    function collectContractsV1FarmRiskBufferFundRewardBatch(
        IPool[] calldata _pools
    ) external virtual returns (uint256 rewardDebt) {
        rewardDebt = routerV1.pluginCollectFarmRiskBufferFundRewardBatch(_pools, msg.sender, address(this));
    }

    function collectContractsV1FarmReferralRewardBatch(
        IPool[] calldata _pools,
        uint256[] calldata _referralTokens
    ) external virtual returns (uint256 rewardDebt) {
        _validateOwner(_referralTokens);
        return routerV1.pluginCollectFarmReferralRewardBatch(_pools, _referralTokens, address(this));
    }

    function collectContractsV1StakingRewardBatch(
        uint256[] calldata _ids
    ) external virtual returns (uint256 rewardDebt) {
        rewardDebt = routerV1.pluginCollectStakingRewardBatch(msg.sender, address(this), _ids);
    }

    function collectContractsV1V3PosStakingRewardBatch(
        uint256[] calldata _ids
    ) external virtual returns (uint256 rewardDebt) {
        rewardDebt = routerV1.pluginCollectV3PosStakingRewardBatch(msg.sender, address(this), _ids);
    }

    function collectContractsV1ArchitectRewardBatch(
        uint256[] calldata _tokenIDs
    ) external virtual returns (uint256 rewardDebt) {
        _validateOwner(_tokenIDs);
        rewardDebt = routerV1.pluginCollectArchitectRewardBatch(address(this), _tokenIDs);
    }

    function collectContractsV1FarmRewardBatch(
        PackedValue _nonceAndLockupPeriod,
        PackedValue[] calldata _packedPoolRewardValues,
        bytes calldata _signature,
        address _receiver
    ) external virtual {
        distributorV2.collectBatch(msg.sender, _nonceAndLockupPeriod, _packedPoolRewardValues, _signature, _receiver);
    }

    function _validateOwner(uint256[] calldata _referralTokens) internal view virtual {
        (address caller, uint256 tokensLen) = (msg.sender, _referralTokens.length);
        for (uint256 i; i < tokensLen; ++i) {
            if (EFC.ownerOf(_referralTokens[i]) != caller)
                revert InvalidCaller(caller, EFC.ownerOf(_referralTokens[i]));
        }
    }
}
