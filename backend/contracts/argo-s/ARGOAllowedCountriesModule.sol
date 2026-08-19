// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../compliance/modular/IModularCompliance.sol";
import "../compliance/modular/modules/AbstractModule.sol";
import "../token/IToken.sol";

/// @title ARGO-S country allowlist
/// @notice Applies default-deny eligibility based on the country stored in IdentityRegistry.
contract ARGOAllowedCountriesModule is AbstractModule {
    mapping(address => mapping(uint16 => bool)) private _allowedCountry;

    event CountryPolicyUpdated(address indexed compliance, uint16 indexed country, bool allowed);

    /// @notice Updates one country policy through the owning ModularCompliance contract.
    function setCountryAllowed(uint16 country, bool allowed) external onlyComplianceCall {
        _allowedCountry[msg.sender][country] = allowed;
        emit CountryPolicyUpdated(msg.sender, country, allowed);
    }

    /// @notice Updates several country policies atomically.
    function batchSetCountriesAllowed(uint16[] calldata countries, bool allowed) external onlyComplianceCall {
        for (uint256 i = 0; i < countries.length; i++) {
            _allowedCountry[msg.sender][countries[i]] = allowed;
            emit CountryPolicyUpdated(msg.sender, countries[i], allowed);
        }
    }

    // solhint-disable-next-line no-empty-blocks
    function moduleTransferAction(address, address, uint256) external override onlyComplianceCall { }

    // solhint-disable-next-line no-empty-blocks
    function moduleMintAction(address, uint256) external override onlyComplianceCall { }

    // solhint-disable-next-line no-empty-blocks
    function moduleBurnAction(address, uint256) external override onlyComplianceCall { }

    /// @notice Allows mint or transfer only when the recipient country is explicitly allowed.
    function moduleCheck(
        address,
        address to,
        uint256,
        address compliance
    ) external view override onlyBoundCompliance(compliance) returns (bool) {
        address token = IModularCompliance(compliance).getTokenBound();
        uint16 country = IToken(token).identityRegistry().investorCountry(to);
        return _allowedCountry[compliance][country];
    }

    function canComplianceBind(address compliance) external view override returns (bool) {
        return compliance != address(0) && IModularCompliance(compliance).getTokenBound() != address(0);
    }

    function isCountryAllowed(address compliance, uint16 country) external view returns (bool) {
        return _allowedCountry[compliance][country];
    }

    function isPlugAndPlay() external pure override returns (bool) {
        return false;
    }

    function name() external pure override returns (string memory) {
        return "ARGO Allowed Countries Module";
    }
}
