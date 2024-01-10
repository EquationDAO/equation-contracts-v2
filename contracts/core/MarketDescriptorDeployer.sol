// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./MarketDescriptor.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

/// @title Market Descriptor Deployer
/// @notice This contract is used to deploy market descriptors with deterministic addresses.
/// It can also save gas when deploying descriptors.
contract MarketDescriptorDeployer {
    /// @notice Mapping of market symbol to their descriptors
    mapping(string symbol => MarketDescriptor) public descriptors;

    /// @notice Emiited when a market descriptor is deployed
    /// @param symbol The symbol of the market
    /// @param descriptor The address of the deployed market descriptor
    event MarketDescriptorDeployed(string symbol, MarketDescriptor descriptor);

    /// @notice Error thrown when the symbol is empty
    error SymbolMustNotBeEmpty();
    /// @notice Error thrown when the market descriptor is already deployed
    error MarketDescriptorAlreadyDeployed(string symbol);

    /// @notice Deploy a market descriptor
    /// @dev The address of the deployed market descriptor is deterministic based on the symbol.
    /// This function will revert if the descriptor is already deployed.
    /// @param _symbol The symbol of the market
    function deploy(string calldata _symbol) external {
        if (bytes(_symbol).length == 0) revert SymbolMustNotBeEmpty();

        if (address(descriptors[_symbol]) != address(0)) revert MarketDescriptorAlreadyDeployed(_symbol);

        address addr = Create2.deploy(0, keccak256(abi.encodePacked(_symbol)), type(MarketDescriptor).creationCode);
        MarketDescriptor descriptor = MarketDescriptor(addr);
        descriptor.initialize(_symbol);

        descriptors[_symbol] = descriptor;

        emit MarketDescriptorDeployed(_symbol, descriptor);
    }
}
