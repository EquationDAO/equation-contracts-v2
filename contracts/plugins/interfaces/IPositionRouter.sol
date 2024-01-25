// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {Side} from "../../types/Side.sol";
import "../../core/interfaces/IMarketDescriptor.sol";

interface IPositionRouter {
    enum RequestType {
        IncreaseLiquidityPosition,
        DecreaseLiquidityPosition,
        IncreasePosition,
        DecreasePosition
    }

    struct IncreaseLiquidityPositionRequest {
        address account;
        IMarketDescriptor market;
        uint128 marginDelta;
        uint128 liquidityDelta;
        uint128 acceptableMinMargin;
        uint256 executionFee;
        uint96 blockNumber;
        uint64 blockTime;
    }

    struct DecreaseLiquidityPositionRequest {
        address account;
        IMarketDescriptor market;
        uint128 marginDelta;
        uint128 liquidityDelta;
        uint128 acceptableMinMargin;
        uint256 executionFee;
        uint96 blockNumber;
        uint64 blockTime;
        address receiver;
    }

    struct IncreasePositionRequest {
        address account;
        IMarketDescriptor market;
        Side side;
        uint128 marginDelta;
        uint128 sizeDelta;
        uint160 acceptableTradePriceX96;
        uint256 executionFee;
        uint96 blockNumber;
        uint64 blockTime;
    }

    struct DecreasePositionRequest {
        address account;
        IMarketDescriptor market;
        Side side;
        uint128 marginDelta;
        uint128 sizeDelta;
        uint160 acceptableTradePriceX96;
        uint256 executionFee;
        uint96 blockNumber;
        uint64 blockTime;
        address receiver;
    }

    struct ClosePositionParameter {
        IMarketDescriptor market;
        Side side;
    }

    /// @notice Emitted when min execution fee updated
    /// @param minExecutionFee New min execution fee after the update
    event MinExecutionFeeUpdated(uint256 minExecutionFee);

    /// @notice Emitted when position executor updated
    /// @param account Account to update
    /// @param active Whether active after the update
    event PositionExecutorUpdated(address indexed account, bool active);

    /// @notice Emitted when delay parameter updated
    /// @param minBlockDelayExecutor The new min block delay for executor to execute requests
    /// @param minTimeDelayPublic The new min time delay for public to execute requests
    /// @param maxTimeDelay The new max time delay until request expires
    event DelayValuesUpdated(uint32 minBlockDelayExecutor, uint32 minTimeDelayPublic, uint32 maxTimeDelay);

    /// @notice Emitted when increase liquidity position request created
    /// @param account Owner of the request
    /// @param market The market in which to increase liquidity position
    /// @param marginDelta The increase in liquidity position margin
    /// @param liquidityDelta The increase in liquidity position liquidity
    /// @param acceptableMinMargin The min acceptable margin of the request
    /// @param executionFee Amount of fee for the executor to carry out the request
    /// @param index Index of the request
    event IncreaseLiquidityPositionCreated(
        address indexed account,
        IMarketDescriptor indexed market,
        uint128 marginDelta,
        uint256 liquidityDelta,
        uint256 acceptableMinMargin,
        uint256 executionFee,
        uint128 indexed index
    );

    /// @notice Emitted when increase liquidity position request cancelled
    /// @param index Index of the cancelled request
    /// @param executionFeeReceiver Receiver of the request execution fee
    event IncreaseLiquidityPositionCancelled(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when increase liquidity position request executed
    /// @param index Index of the order to execute
    /// @param executionFeeReceiver Receiver of the order execution fee
    event IncreaseLiquidityPositionExecuted(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when decrease liquidity position request created
    /// @param account Owner of the request
    /// @param market The market in which to decrease liquidity position
    /// @param marginDelta The decrease in liquidity position margin
    /// @param liquidityDelta The decrease in liquidity position liquidity
    /// @param acceptableMinMargin The min acceptable margin of the request
    /// @param receiver Address of the margin receiver
    /// @param executionFee  Amount of fee for the executor to carry out the request
    /// @param index Index of the request
    event DecreaseLiquidityPositionCreated(
        address indexed account,
        IMarketDescriptor indexed market,
        uint128 marginDelta,
        uint256 liquidityDelta,
        uint256 acceptableMinMargin,
        address receiver,
        uint256 executionFee,
        uint128 indexed index
    );

    /// @notice Emitted when decrease liquidity position request cancelled
    /// @param index Index of cancelled request
    /// @param executionFeeReceiver Receiver of the request execution fee
    event DecreaseLiquidityPositionCancelled(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when decrease liquidity position request executed
    /// @param index Index of the executed request
    /// @param executionFeeReceiver Receiver of the request execution fee
    event DecreaseLiquidityPositionExecuted(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when open or increase an existing position size request created
    /// @param account Owner of the request
    /// @param market The market in which to increase position
    /// @param side The side of the position (Long or Short)
    /// @param marginDelta The increase in position margin
    /// @param sizeDelta The increase in position size
    /// @param acceptableTradePriceX96 The worst trade price of the request
    /// @param executionFee Amount of fee for the executor to carry out the request
    /// @param index Index of the request
    event IncreasePositionCreated(
        address indexed account,
        IMarketDescriptor indexed market,
        Side side,
        uint128 marginDelta,
        uint128 sizeDelta,
        uint160 acceptableTradePriceX96,
        uint256 executionFee,
        uint128 indexed index
    );

    /// @notice Emitted when increase position request cancelled
    /// @param index Index of the cancelled request
    /// @param executionFeeReceiver Receiver of the cancelled request execution fee
    event IncreasePositionCancelled(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when increase position request executed
    /// @param index Index of the executed request
    /// @param executionFeeReceiver Receiver of the executed request execution fee
    event IncreasePositionExecuted(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when close or decrease existing position size request created
    /// @param account Owner of the request
    /// @param market The market in which to decrease position
    /// @param side The side of the position (Long or Short)
    /// @param marginDelta The decrease in position margin
    /// @param sizeDelta The decrease in position size
    /// @param acceptableTradePriceX96 The worst trade price of the request
    /// @param executionFee Amount of fee for the executor to carry out the order
    /// @param index Index of the request
    /// @param receiver Address of the margin receiver
    event DecreasePositionCreated(
        address indexed account,
        IMarketDescriptor indexed market,
        Side side,
        uint128 marginDelta,
        uint128 sizeDelta,
        uint160 acceptableTradePriceX96,
        address receiver,
        uint256 executionFee,
        uint128 indexed index
    );

    /// @notice Emitted when decrease position request cancelled
    /// @param index Index of the cancelled decrease position request
    /// @param executionFeeReceiver Receiver of the request execution fee
    event DecreasePositionCancelled(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when decrease position request executed
    /// @param index Index of the executed decrease position request
    /// @param executionFeeReceiver Receiver of the request execution fee
    event DecreasePositionExecuted(uint128 indexed index, address payable executionFeeReceiver);

    /// @notice Emitted when requests execution reverted
    /// @param reqType Request type
    /// @param index Index of the failed request
    /// @param shortenedReason The error selector for the failure
    event ExecuteFailed(RequestType indexed reqType, uint128 indexed index, bytes4 shortenedReason);

    /// @notice Execution fee is insufficient
    /// @param available The available execution fee amount
    /// @param required The required minimum execution fee amount
    error InsufficientExecutionFee(uint256 available, uint256 required);

    /// @notice Execution fee is invalid
    /// @param available The available execution fee amount
    /// @param required The required execution fee amount
    error InvalidExecutionFee(uint256 available, uint256 required);

    /// @notice Position not found
    /// @param market The market in which to close position
    /// @param account The account of the position
    /// @param side The side of the position
    error PositionNotFound(IMarketDescriptor market, address account, Side side);

    /// @notice Liquidity position not found
    /// @param market The market in which to close liquidity position
    /// @param account The account of the liquidity position
    error LiquidityNotFound(IMarketDescriptor market, address account);

    /// @notice Request expired
    /// @param expiredAt When the request is expired
    error Expired(uint256 expiredAt);

    /// @notice Too early to execute request
    /// @param earliest The earliest time to execute the request
    error TooEarly(uint256 earliest);

    /// @notice Trade price exceeds limit
    error InvalidTradePrice(uint160 tradePriceX96, uint160 acceptableTradePriceX96);

    /// @notice Margin is less than acceptable min margin
    error InvalidMargin(uint128 margin, uint128 acceptableMinMargin);

    /// @notice Update position executor
    /// @param account Account to update
    /// @param active Updated status
    function updatePositionExecutor(address account, bool active) external;

    /// @notice Update delay parameters
    /// @param minBlockDelayExecutor New min block delay for executor to execute requests
    /// @param minTimeDelayPublic New min time delay for public to execute requests
    /// @param maxTimeDelay New max time delay until request expires
    function updateDelayValues(uint32 minBlockDelayExecutor, uint32 minTimeDelayPublic, uint32 maxTimeDelay) external;

    /// @notice Update minimum execution fee
    /// @param minExecutionFee New min execution fee
    function updateMinExecutionFee(uint256 minExecutionFee) external;

    /// @notice Update the gas limit for executing requests
    /// @param executionGasLimit New execution gas limit
    function updateExecutionGasLimit(uint160 executionGasLimit) external;

    /// @notice Create increase liquidity position request
    /// @param market The market in which to increase liquidity position
    /// @param marginDelta Margin delta of the liquidity position
    /// @param liquidityDelta Liquidity delta of the liquidity position
    /// @param acceptableMinMargin The min acceptable margin of the request
    /// @return index Index of the request
    function createIncreaseLiquidityPosition(
        IMarketDescriptor market,
        uint128 marginDelta,
        uint128 liquidityDelta,
        uint128 acceptableMinMargin
    ) external payable returns (uint128 index);

    /// @notice Cancel increase liquidity position request
    /// @param index Index of the request to cancel
    /// @param executionFeeReceiver Receiver of request execution fee
    /// @return cancelled True if the cancellation succeeds or request not exists
    function cancelIncreaseLiquidityPosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool cancelled);

    /// @notice Execute increase liquidity position request
    /// @param index Index of request to execute
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return executed True if the execution succeeds or request not exists
    function executeIncreaseLiquidityPosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool executed);

    /// @notice Execute multiple liquidity position requests
    /// @param endIndex The maximum request index to execute, excluded
    /// @param executionFeeReceiver Receiver of the request execution fees
    function executeIncreaseLiquidityPositions(uint128 endIndex, address payable executionFeeReceiver) external;

    /// @notice Create decrease liquidity position request
    /// @param market The market in which to decrease liquidity position
    /// @param marginDelta The decrease in liquidity position margin
    /// @param liquidityDelta The decrease in liquidity position liquidity
    /// @param acceptableMinMargin The min acceptable margin of the request
    /// @param receiver Address of the margin receiver
    /// @return index The request index
    function createDecreaseLiquidityPosition(
        IMarketDescriptor market,
        uint128 marginDelta,
        uint128 liquidityDelta,
        uint128 acceptableMinMargin,
        address receiver
    ) external payable returns (uint128 index);

    /// @notice Create multiple close liquidity position requests in a single call
    /// @param markets Markets to close liquidity position
    /// @param receiver Margin recipient address
    /// @return indices The request indices
    function createCloseLiquidityPositionsBatch(
        IMarketDescriptor[] calldata markets,
        address receiver
    ) external payable returns (uint128[] memory indices);

    /// @notice Cancel decrease liquidity position request
    /// @param index Index of the request to cancel
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return cancelled True if the cancellation succeeds or request not exists
    function cancelDecreaseLiquidityPosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool cancelled);

    /// @notice Execute decrease liquidity position request
    /// @param index Index of the request to execute
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return executed True if the execution succeeds or request not exists
    function executeDecreaseLiquidityPosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool executed);

    /// @notice Execute multiple decrease liquidity position requests
    /// @param endIndex The maximum request index to execute, excluded
    /// @param executionFeeReceiver Receiver of the request execution fee
    function executeDecreaseLiquidityPositions(uint128 endIndex, address payable executionFeeReceiver) external;

    /// @notice Execute increase liquidation fund position request
    /// @param market The market in which to increase liquidation fund position
    /// @param liquidityDelta The increase in liquidity
    function executeIncreaseLiquidationFundPosition(IMarketDescriptor market, uint128 liquidityDelta) external;

    /// @notice Execute decrease liquidation fund position request
    /// @param market The market in which to decrease liquidation fund position
    /// @param liquidityDelta The decrease in liquidity
    /// @param receiver Address of the margin receiver
    function executeDecreaseLiquidationFundPosition(
        IMarketDescriptor market,
        uint128 liquidityDelta,
        address receiver
    ) external;

    /// @notice Create open or increase the size of existing position request
    /// @param market The market in which to increase position
    /// @param side The side of the position (Long or Short)
    /// @param marginDelta The increase in position margin
    /// @param sizeDelta The increase in position size
    /// @param acceptableTradePriceX96 The worst trade price of the request, as a Q64.96
    /// @return index Index of the request
    function createIncreasePosition(
        IMarketDescriptor market,
        Side side,
        uint128 marginDelta,
        uint128 sizeDelta,
        uint160 acceptableTradePriceX96
    ) external payable returns (uint128 index);

    /// @notice Cancel increase position request
    /// @param index Index of the request to cancel
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return cancelled True if the cancellation succeeds or request not exists
    function cancelIncreasePosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool cancelled);

    /// @notice Execute increase position request
    /// @param index Index of the request to execute
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return executed True if the execution succeeds or request not exists
    function executeIncreasePosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool executed);

    /// @notice Execute multiple increase position requests
    /// @param endIndex The maximum request index to execute, excluded
    /// @param executionFeeReceiver Receiver of the request execution fee
    function executeIncreasePositions(uint128 endIndex, address payable executionFeeReceiver) external;

    /// @notice Create decrease position request
    /// @param market The market in which to decrease position
    /// @param side The side of the position (Long or Short)
    /// @param marginDelta The decrease in position margin
    /// @param sizeDelta The decrease in position size
    /// @param acceptableTradePriceX96 The worst trade price of the request, as a Q64.96
    /// @param receiver Margin recipient address
    /// @return index The request index
    function createDecreasePosition(
        IMarketDescriptor market,
        Side side,
        uint128 marginDelta,
        uint128 sizeDelta,
        uint160 acceptableTradePriceX96,
        address receiver
    ) external payable returns (uint128 index);

    /// @notice Create multiple close position requests in a single call
    /// @param parameters Parameters of the close position requests
    /// @param receiver Margin recipient address
    /// @return indices The request indices
    function createClosePositionsBatch(
        ClosePositionParameter[] calldata parameters,
        address receiver
    ) external payable returns (uint128[] memory indices);

    /// @notice Cancel decrease position request
    /// @param index Index of the request to cancel
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return cancelled True if the cancellation succeeds or request not exists
    function cancelDecreasePosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool cancelled);

    /// @notice Execute decrease position request
    /// @param index Index of the request to execute
    /// @param executionFeeReceiver Receiver of the request execution fee
    /// @return executed True if the execution succeeds or request not exists
    function executeDecreasePosition(
        uint128 index,
        address payable executionFeeReceiver
    ) external returns (bool executed);

    /// @notice Execute multiple decrease position requests
    /// @param endIndex The maximum request index to execute, excluded
    /// @param executionFeeReceiver Receiver of the request execution fee
    function executeDecreasePositions(uint128 endIndex, address payable executionFeeReceiver) external;
}
