// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./Router.sol";
import "./interfaces/IPositionRouter.sol";
import {M as Math} from "../libraries/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PositionRouter is IPositionRouter, Governable, ReentrancyGuard {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    IERC20 public immutable usd;
    Router public immutable router;
    IMarketManager public immutable marketManager;

    uint256 public minExecutionFee;

    // pack into a single slot to save gas
    uint32 public minBlockDelayExecutor;
    uint32 public minTimeDelayPublic = 3 minutes;
    uint32 public maxTimeDelay = 30 minutes;
    uint160 public executionGasLimit = 1_000_000 wei;

    mapping(address => bool) public positionExecutors;

    // LP stats
    mapping(uint128 => IncreaseLiquidityPositionRequest) public increaseLiquidityPositionRequests;
    uint128 public increaseLiquidityPositionIndex;
    uint128 public increaseLiquidityPositionIndexNext;

    mapping(uint128 => DecreaseLiquidityPositionRequest) public decreaseLiquidityPositionRequests;
    uint128 public decreaseLiquidityPositionIndex;
    uint128 public decreaseLiquidityPositionIndexNext;

    // Trader stats
    mapping(uint128 => IncreasePositionRequest) public increasePositionRequests;
    uint128 public increasePositionIndex;
    uint128 public increasePositionIndexNext;

    mapping(uint128 => DecreasePositionRequest) public decreasePositionRequests;
    uint128 public decreasePositionIndex;
    uint128 public decreasePositionIndexNext;

    modifier onlyPositionExecutor() {
        if (!positionExecutors[msg.sender]) revert Forbidden();
        _;
    }

    constructor(IERC20 _usd, Router _router, IMarketManager _marketManager, uint256 _minExecutionFee) {
        usd = _usd;
        router = _router;
        marketManager = _marketManager;
        minExecutionFee = _minExecutionFee;
        emit MinExecutionFeeUpdated(_minExecutionFee);
    }

    /// @inheritdoc IPositionRouter
    function updatePositionExecutor(address _account, bool _active) external override onlyGov {
        positionExecutors[_account] = _active;
        emit PositionExecutorUpdated(_account, _active);
    }

    /// @inheritdoc IPositionRouter
    function updateDelayValues(
        uint32 _minBlockDelayExecutor,
        uint32 _minTimeDelayPublic,
        uint32 _maxTimeDelay
    ) external override onlyGov {
        minBlockDelayExecutor = _minBlockDelayExecutor;
        minTimeDelayPublic = _minTimeDelayPublic;
        maxTimeDelay = _maxTimeDelay;
        emit DelayValuesUpdated(_minBlockDelayExecutor, _minTimeDelayPublic, _maxTimeDelay);
    }

    /// @inheritdoc IPositionRouter
    function updateMinExecutionFee(uint256 _minExecutionFee) external override onlyGov {
        minExecutionFee = _minExecutionFee;
        emit MinExecutionFeeUpdated(_minExecutionFee);
    }

    /// @inheritdoc IPositionRouter
    function updateExecutionGasLimit(uint160 _executionGasLimit) external override onlyGov {
        executionGasLimit = _executionGasLimit;
    }

    /// @inheritdoc IPositionRouter
    function createIncreaseLiquidityPosition(
        IMarketDescriptor _market,
        uint128 _marginDelta,
        uint128 _liquidityDelta,
        uint128 _acceptableMinMargin
    ) external payable override nonReentrant returns (uint128 index) {
        if (msg.value < minExecutionFee) revert InsufficientExecutionFee(msg.value, minExecutionFee);

        if (_marginDelta > 0) router.pluginTransfer(usd, msg.sender, address(this), _marginDelta);

        index = increaseLiquidityPositionIndexNext++;
        increaseLiquidityPositionRequests[index] = IncreaseLiquidityPositionRequest({
            account: msg.sender,
            market: _market,
            marginDelta: _marginDelta,
            liquidityDelta: _liquidityDelta,
            acceptableMinMargin: _acceptableMinMargin,
            executionFee: msg.value,
            blockNumber: block.number.toUint96(),
            blockTime: block.timestamp.toUint64()
        });

        emit IncreaseLiquidityPositionCreated(
            msg.sender,
            _market,
            _marginDelta,
            _liquidityDelta,
            _acceptableMinMargin,
            msg.value,
            index
        );
    }

    /// @inheritdoc IPositionRouter
    function cancelIncreaseLiquidityPosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        IncreaseLiquidityPositionRequest memory request = increaseLiquidityPositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldCancel = _shouldCancel(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) return false;

        if (request.marginDelta > 0) usd.safeTransfer(request.account, request.marginDelta);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete increaseLiquidityPositionRequests[_index];

        emit IncreaseLiquidityPositionCancelled(_index, _executionFeeReceiver);

        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeIncreaseLiquidityPosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        IncreaseLiquidityPositionRequest memory request = increaseLiquidityPositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldExecute = _shouldExecute(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) return false;

        if (request.marginDelta > 0) usd.safeTransfer(address(marketManager), request.marginDelta);

        // Note that the gas specified here is just an upper limit,
        // when the gas left is lower than this value, code can still be executed
        uint128 marginAfter = router.pluginIncreaseLiquidityPosition{gas: executionGasLimit}(
            request.market,
            request.account,
            request.marginDelta,
            request.liquidityDelta
        );

        _validateMargin(marginAfter, request.acceptableMinMargin);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete increaseLiquidityPositionRequests[_index];

        emit IncreaseLiquidityPositionExecuted(_index, _executionFeeReceiver);
        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeIncreaseLiquidityPositions(
        uint128 _endIndex,
        address payable _executionFeeReceiver
    ) external override onlyPositionExecutor {
        uint128 index = increaseLiquidityPositionIndex;
        _endIndex = uint128(Math.min(_endIndex, increaseLiquidityPositionIndexNext));

        while (index < _endIndex) {
            try this.executeIncreaseLiquidityPosition(index, _executionFeeReceiver) returns (bool _executed) {
                if (!_executed) break;
            } catch (bytes memory reason) {
                bytes4 errorTypeSelector = _decodeShortenedReason(reason);
                emit ExecuteFailed(RequestType.IncreaseLiquidityPosition, index, errorTypeSelector);

                try this.cancelIncreaseLiquidityPosition(index, _executionFeeReceiver) returns (bool _cancelled) {
                    if (!_cancelled) break;
                } catch {}
            }
            // prettier-ignore
            unchecked { ++index; }
        }

        increaseLiquidityPositionIndex = index;
    }

    /// @inheritdoc IPositionRouter
    function createDecreaseLiquidityPosition(
        IMarketDescriptor _market,
        uint128 _marginDelta,
        uint128 _liquidityDelta,
        uint128 _acceptableMinMargin,
        address _receiver
    ) external payable override nonReentrant returns (uint128 index) {
        if (msg.value < minExecutionFee) revert InsufficientExecutionFee(msg.value, minExecutionFee);

        index = _createDecreaseLiquidityPosition(
            _market,
            _marginDelta,
            _liquidityDelta,
            _acceptableMinMargin,
            _receiver,
            msg.value
        );
    }

    /// @inheritdoc IPositionRouter
    function createCloseLiquidityPositionsBatch(
        IMarketDescriptor[] calldata markets,
        address receiver
    ) external payable override nonReentrant returns (uint128[] memory indices) {
        uint256 len = markets.length;
        if (len == 0) return new uint128[](0);

        unchecked {
            uint256 executionFeePerRequest = msg.value / len;
            if (executionFeePerRequest < minExecutionFee)
                revert InsufficientExecutionFee(executionFeePerRequest, minExecutionFee);

            if (executionFeePerRequest * len != msg.value)
                revert InvalidExecutionFee(msg.value, executionFeePerRequest * len);

            indices = new uint128[](markets.length);
            for (uint256 i; i < len; ++i) {
                IMarketDescriptor market = markets[i];
                IMarketManager.LiquidityPosition memory position = marketManager.liquidityPositions(market, msg.sender);
                if (position.liquidity == 0) revert LiquidityNotFound(market, msg.sender);

                indices[i] = _createDecreaseLiquidityPosition(
                    market,
                    0,
                    position.liquidity,
                    0,
                    receiver,
                    executionFeePerRequest
                );
            }
        }
    }

    /// @inheritdoc IPositionRouter
    function cancelDecreaseLiquidityPosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        DecreaseLiquidityPositionRequest memory request = decreaseLiquidityPositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldCancel = _shouldCancel(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) return false;

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete decreaseLiquidityPositionRequests[_index];

        emit DecreaseLiquidityPositionCancelled(_index, _executionFeeReceiver);

        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeDecreaseLiquidityPosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        DecreaseLiquidityPositionRequest memory request = decreaseLiquidityPositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldExecute = _shouldExecute(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) return false;

        uint128 marginAfter = router.pluginDecreaseLiquidityPosition{gas: executionGasLimit}(
            request.market,
            request.account,
            request.marginDelta,
            request.liquidityDelta,
            request.receiver
        );

        _validateMargin(marginAfter, request.acceptableMinMargin);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete decreaseLiquidityPositionRequests[_index];

        emit DecreaseLiquidityPositionExecuted(_index, _executionFeeReceiver);
        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeDecreaseLiquidityPositions(
        uint128 _endIndex,
        address payable _executionFeeReceiver
    ) external override onlyPositionExecutor {
        uint128 index = decreaseLiquidityPositionIndex;
        _endIndex = uint128(Math.min(_endIndex, decreaseLiquidityPositionIndexNext));

        while (index < _endIndex) {
            try this.executeDecreaseLiquidityPosition(index, _executionFeeReceiver) returns (bool _executed) {
                if (!_executed) break;
            } catch (bytes memory reason) {
                bytes4 errorTypeSelector = _decodeShortenedReason(reason);
                emit ExecuteFailed(RequestType.DecreaseLiquidityPosition, index, errorTypeSelector);

                try this.cancelDecreaseLiquidityPosition(index, _executionFeeReceiver) returns (bool _cancelled) {
                    if (!_cancelled) break;
                } catch {}
            }
            // prettier-ignore
            unchecked { ++index; }
        }

        decreaseLiquidityPositionIndex = index;
    }

    /// @inheritdoc IPositionRouter
    function executeIncreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        uint128 _liquidityDelta
    ) external override {
        router.pluginTransfer(usd, msg.sender, address(marketManager), _liquidityDelta);

        router.pluginIncreaseLiquidationFundPosition(_market, msg.sender, _liquidityDelta);
    }

    /// @inheritdoc IPositionRouter
    function executeDecreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        uint128 _liquidityDelta,
        address _receiver
    ) external override {
        router.pluginDecreaseLiquidationFundPosition(_market, msg.sender, _liquidityDelta, _receiver);
    }

    /// @inheritdoc IPositionRouter
    function createIncreasePosition(
        IMarketDescriptor _market,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta,
        uint160 _acceptableTradePriceX96
    ) external payable override nonReentrant returns (uint128 index) {
        _side.requireValid();
        if (msg.value < minExecutionFee) revert InsufficientExecutionFee(msg.value, minExecutionFee);

        if (_marginDelta > 0) router.pluginTransfer(usd, msg.sender, address(this), _marginDelta);

        index = increasePositionIndexNext++;
        increasePositionRequests[index] = IncreasePositionRequest({
            account: msg.sender,
            market: _market,
            side: _side,
            marginDelta: _marginDelta,
            sizeDelta: _sizeDelta,
            acceptableTradePriceX96: _acceptableTradePriceX96,
            executionFee: msg.value,
            blockNumber: block.number.toUint96(),
            blockTime: block.timestamp.toUint64()
        });

        emit IncreasePositionCreated(
            msg.sender,
            _market,
            _side,
            _marginDelta,
            _sizeDelta,
            _acceptableTradePriceX96,
            msg.value,
            index
        );
    }

    /// @inheritdoc IPositionRouter
    function cancelIncreasePosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        IncreasePositionRequest memory request = increasePositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldCancel = _shouldCancel(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) return false;

        if (request.marginDelta > 0) usd.safeTransfer(request.account, request.marginDelta);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete increasePositionRequests[_index];

        emit IncreasePositionCancelled(_index, _executionFeeReceiver);

        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeIncreasePosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        IncreasePositionRequest memory request = increasePositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldExecute = _shouldExecute(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) return false;

        if (request.marginDelta > 0) usd.safeTransfer(address(marketManager), request.marginDelta);

        uint160 tradePriceX96 = router.pluginIncreasePosition{gas: executionGasLimit}(
            request.market,
            request.account,
            request.side,
            request.marginDelta,
            request.sizeDelta
        );

        if (request.acceptableTradePriceX96 != 0)
            _validateTradePriceX96(request.side, tradePriceX96, request.acceptableTradePriceX96);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete increasePositionRequests[_index];

        emit IncreasePositionExecuted(_index, _executionFeeReceiver);
        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeIncreasePositions(
        uint128 _endIndex,
        address payable _executionFeeReceiver
    ) external override onlyPositionExecutor {
        uint128 index = increasePositionIndex;
        _endIndex = uint128(Math.min(_endIndex, increasePositionIndexNext));

        while (index < _endIndex) {
            try this.executeIncreasePosition(index, _executionFeeReceiver) returns (bool _executed) {
                if (!_executed) break;
            } catch (bytes memory reason) {
                bytes4 errorTypeSelector = _decodeShortenedReason(reason);
                emit ExecuteFailed(RequestType.IncreasePosition, index, errorTypeSelector);

                try this.cancelIncreasePosition(index, _executionFeeReceiver) returns (bool _cancelled) {
                    if (!_cancelled) break;
                } catch {}
            }
            // prettier-ignore
            unchecked { ++index; }
        }

        increasePositionIndex = index;
    }

    /// @inheritdoc IPositionRouter
    function createDecreasePosition(
        IMarketDescriptor _market,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta,
        uint160 _acceptableTradePriceX96,
        address _receiver
    ) external payable override nonReentrant returns (uint128 index) {
        _side.requireValid();
        if (msg.value < minExecutionFee) revert InsufficientExecutionFee(msg.value, minExecutionFee);

        index = _createDecreasePosition(
            _market,
            _side,
            _marginDelta,
            _sizeDelta,
            _acceptableTradePriceX96,
            _receiver,
            msg.value
        );
    }

    /// @inheritdoc IPositionRouter
    function createClosePositionsBatch(
        ClosePositionParameter[] calldata parameters,
        address receiver
    ) external payable override nonReentrant returns (uint128[] memory indices) {
        uint256 len = parameters.length;
        if (len == 0) return new uint128[](0);

        unchecked {
            uint256 executionFeePerRequest = msg.value / len;
            if (executionFeePerRequest < minExecutionFee)
                revert InsufficientExecutionFee(executionFeePerRequest, minExecutionFee);

            if (executionFeePerRequest * len != msg.value)
                revert InvalidExecutionFee(msg.value, executionFeePerRequest * len);

            indices = new uint128[](parameters.length);
            for (uint256 i; i < len; ++i) {
                ClosePositionParameter memory parameter = parameters[i];
                IMarketManager.Position memory position = marketManager.positions(
                    parameter.market,
                    msg.sender,
                    parameter.side
                );
                if (position.size == 0) revert PositionNotFound(parameter.market, msg.sender, parameter.side);

                indices[i] = _createDecreasePosition(
                    parameter.market,
                    parameter.side,
                    0,
                    position.size,
                    0,
                    receiver,
                    executionFeePerRequest
                );
            }
        }
    }

    /// @inheritdoc IPositionRouter
    function cancelDecreasePosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        DecreasePositionRequest memory request = decreasePositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldCancel = _shouldCancel(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) return false;

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete decreasePositionRequests[_index];

        emit DecreasePositionCancelled(_index, _executionFeeReceiver);

        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeDecreasePosition(
        uint128 _index,
        address payable _executionFeeReceiver
    ) external override nonReentrant returns (bool) {
        DecreasePositionRequest memory request = decreasePositionRequests[_index];
        if (request.account == address(0)) return true;

        bool shouldExecute = _shouldExecute(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) return false;

        uint160 tradePriceX96 = router.pluginDecreasePosition{gas: executionGasLimit}(
            request.market,
            request.account,
            request.side,
            request.marginDelta,
            request.sizeDelta,
            request.receiver
        );

        if (request.acceptableTradePriceX96 != 0)
            _validateTradePriceX96(request.side.flip(), tradePriceX96, request.acceptableTradePriceX96);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        delete decreasePositionRequests[_index];

        emit DecreasePositionExecuted(_index, _executionFeeReceiver);
        return true;
    }

    /// @inheritdoc IPositionRouter
    function executeDecreasePositions(
        uint128 _endIndex,
        address payable _executionFeeReceiver
    ) external override onlyPositionExecutor {
        uint128 index = decreasePositionIndex;
        _endIndex = uint128(Math.min(_endIndex, decreasePositionIndexNext));

        while (index < _endIndex) {
            try this.executeDecreasePosition(index, _executionFeeReceiver) returns (bool _executed) {
                if (!_executed) break;
            } catch (bytes memory reason) {
                bytes4 errorTypeSelector = _decodeShortenedReason(reason);
                emit ExecuteFailed(RequestType.DecreasePosition, index, errorTypeSelector);

                try this.cancelDecreasePosition(index, _executionFeeReceiver) returns (bool _cancelled) {
                    if (!_cancelled) break;
                } catch {}
            }
            // prettier-ignore
            unchecked { ++index; }
        }

        decreasePositionIndex = index;
    }

    // validation
    function _shouldCancel(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        return _shouldExecuteOrCancel(_positionBlockNumber, _positionBlockTime, _account);
    }

    function _shouldExecute(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        if (_positionBlockTime + maxTimeDelay <= block.timestamp) revert Expired(_positionBlockTime + maxTimeDelay);

        return _shouldExecuteOrCancel(_positionBlockNumber, _positionBlockTime, _account);
    }

    function _shouldExecuteOrCancel(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        bool isExecutorCall = msg.sender == address(this) || positionExecutors[msg.sender];

        if (isExecutorCall) return _positionBlockNumber + minBlockDelayExecutor <= block.number;

        if (msg.sender != _account) revert Forbidden();

        if (_positionBlockTime + minTimeDelayPublic > block.timestamp)
            revert TooEarly(_positionBlockTime + minTimeDelayPublic);

        return true;
    }

    function _createDecreaseLiquidityPosition(
        IMarketDescriptor _market,
        uint128 _marginDelta,
        uint128 _liquidityDelta,
        uint128 _acceptableMinMargin,
        address _receiver,
        uint256 _executionFee
    ) private returns (uint128 index) {
        index = decreaseLiquidityPositionIndexNext++;
        decreaseLiquidityPositionRequests[index] = DecreaseLiquidityPositionRequest({
            account: msg.sender,
            market: _market,
            marginDelta: _marginDelta,
            liquidityDelta: _liquidityDelta,
            acceptableMinMargin: _acceptableMinMargin,
            executionFee: _executionFee,
            blockNumber: block.number.toUint96(),
            blockTime: block.timestamp.toUint64(),
            receiver: _receiver
        });

        emit DecreaseLiquidityPositionCreated(
            msg.sender,
            _market,
            _marginDelta,
            _liquidityDelta,
            _acceptableMinMargin,
            _receiver,
            _executionFee,
            index
        );
    }

    function _createDecreasePosition(
        IMarketDescriptor _market,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta,
        uint160 _acceptableTradePriceX96,
        address _receiver,
        uint256 _executionFee
    ) private returns (uint128 index) {
        index = decreasePositionIndexNext++;
        decreasePositionRequests[index] = DecreasePositionRequest({
            account: msg.sender,
            market: _market,
            side: _side,
            marginDelta: _marginDelta,
            sizeDelta: _sizeDelta,
            acceptableTradePriceX96: _acceptableTradePriceX96,
            executionFee: _executionFee,
            blockNumber: block.number.toUint96(),
            blockTime: block.timestamp.toUint64(),
            receiver: _receiver
        });

        emit DecreasePositionCreated(
            msg.sender,
            _market,
            _side,
            _marginDelta,
            _sizeDelta,
            _acceptableTradePriceX96,
            _receiver,
            _executionFee,
            index
        );
    }

    function _validateTradePriceX96(
        Side _side,
        uint160 _tradePriceX96,
        uint160 _acceptableTradePriceX96
    ) internal pure {
        // long makes price up, short makes price down
        if (
            (_side.isLong() && (_tradePriceX96 > _acceptableTradePriceX96)) ||
            (_side.isShort() && (_tradePriceX96 < _acceptableTradePriceX96))
        ) revert InvalidTradePrice(_tradePriceX96, _acceptableTradePriceX96);
    }

    function _validateMargin(uint128 margin, uint128 _acceptableMinMargin) internal pure {
        if (margin < _acceptableMinMargin) revert InvalidMargin(margin, _acceptableMinMargin);
    }

    function _decodeShortenedReason(bytes memory _reason) internal pure virtual returns (bytes4) {
        return bytes4(_reason);
    }

    function _transferOutETH(uint256 _amountOut, address payable _receiver) private {
        _receiver.sendValue(_amountOut);
    }
}
