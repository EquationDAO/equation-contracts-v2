// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "./types/PackedValue.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IMultiMinter {
    function setMinter(address minter, bool enabled) external;
}

interface IPool {}

interface IFeeDistributor {
    /// @notice Invalid lockup period
    error InvalidLockupPeriod(uint16 period);
    /// @notice Invalid NFT owner
    error InvalidNFTOwner(address owner, uint256 tokenID);

    function depositFee(uint256 amount) external;

    function stake(uint256 amount, address account, uint16 period) external;
}

interface IEFC is IERC721 {
    function referrerTokens(address referee) external view returns (uint256 memberTokenId, uint256 connectorTokenId);
}

interface IRouter {
    function EFC() external view returns (IEFC);

    function pluginCollectReferralFee(IPool pool, uint256 referralToken, address receiver) external returns (uint256);

    function pluginCollectFarmLiquidityRewardBatch(
        IPool[] calldata pools,
        address owner,
        address receiver
    ) external returns (uint256 rewardDebt);

    function pluginCollectFarmRiskBufferFundRewardBatch(
        IPool[] calldata pools,
        address owner,
        address receiver
    ) external returns (uint256 rewardDebt);

    function pluginCollectFarmReferralRewardBatch(
        IPool[] calldata pools,
        uint256[] calldata referralTokens,
        address receiver
    ) external returns (uint256 rewardDebt);

    function pluginCollectStakingRewardBatch(
        address owner,
        address receiver,
        uint256[] calldata ids
    ) external returns (uint256 rewardDebt);

    function pluginCollectV3PosStakingRewardBatch(
        address owner,
        address receiver,
        uint256[] calldata ids
    ) external returns (uint256 rewardDebt);

    function pluginCollectArchitectRewardBatch(
        address receiver,
        uint256[] calldata tokenIDs
    ) external returns (uint256 rewardDebt);
}

interface IFarmRewardDistributorV2 {
    /// @notice Event emitted when the collector is enabled or disabled
    /// @param collector The address of the collector
    /// @param enabled Whether the collector is enabled or disabled
    event CollectorUpdated(address indexed collector, bool enabled);
    /// @notice Event emitted when the reward is collected
    /// @param pool The pool from which to collect the reward
    /// @param account The account that collect the reward for
    /// @param rewardType The reward type
    /// @param nonce The nonce of the account
    /// @param receiver The address that received the reward
    /// @param amount The amount of the reward collected
    event RewardCollected(
        address pool,
        address indexed account,
        uint16 indexed rewardType,
        uint16 indexed referralToken,
        uint32 nonce,
        address receiver,
        uint200 amount
    );
    /// @notice Event emitted when the reward is locked and burned
    /// @param account The account that collect the reward for
    /// @param period The lockup period, 0 means no lockup
    /// @param receiver The address that received the unlocked reward or the locked reward
    /// @param lockedOrUnlockedAmount The amount of the unlocked reward or the locked reward
    /// @param burnedAmount The amount of the burned reward
    event RewardLockedAndBurned(
        address indexed account,
        uint16 indexed period,
        address indexed receiver,
        uint256 lockedOrUnlockedAmount,
        uint256 burnedAmount
    );

    /// @notice Error thrown when the nonce is invalid
    /// @param nonce The invalid nonce
    error InvalidNonce(uint32 nonce);
    /// @notice Error thrown when the reward type is invalid
    error InvalidRewardType(uint16 rewardType);
    /// @notice Error thrown when the lockup free rate is invalid
    error InvalidLockupFreeRate(uint32 lockupFreeRate);
    /// @notice Error thrown when the signature is invalid
    error InvalidSignature();

    function signer() external view returns (address);

    function token() external view returns (IERC20);

    function EFC() external view returns (IEFC);

    function feeDistributor() external view returns (IFeeDistributor);

    function lockupFreeRates(uint16 lockupPeriod) external view returns (uint32);

    function rewardTypesDescriptions(uint16 rewardType) external view returns (string memory);

    function collectBatch(
        address account,
        PackedValue nonceAndLockupPeriod,
        PackedValue[] calldata packedPoolRewardValues,
        bytes calldata signature,
        address receiver
    ) external;
}
