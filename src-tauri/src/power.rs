//! Energia: `Windows.System.Power.PowerManager`, orientado a eventos.
//! Em desktops sem bateria o estado diz isso — nunca inventa uma porcentagem.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PowerState {
    pub available: bool,
    pub has_battery: bool,
    /// 0..=100, apenas quando há bateria.
    pub percent: Option<i32>,
    /// "charging" | "discharging" | "idle" | "none"
    pub battery: String,
    /// Fonte de energia externa conectada e suficiente.
    pub plugged: bool,
    /// "adequate" | "inadequate" | "none"
    pub supply: String,
    pub remaining_discharge_min: Option<i64>,
    pub energy_saver: bool,
}

#[cfg(windows)]
pub fn read() -> PowerState {
    use windows::System::Power::{BatteryStatus, EnergySaverStatus, PowerManager, PowerSupplyStatus};
    let battery = PowerManager::BatteryStatus();
    let supply = PowerManager::PowerSupplyStatus();
    let (Ok(battery), Ok(supply)) = (battery, supply) else {
        return PowerState { available: false, battery: "none".into(), supply: "none".into(), ..Default::default() };
    };
    let has_battery = battery != BatteryStatus::NotPresent;
    let percent = if has_battery { PowerManager::RemainingChargePercent().ok().map(|p| p.clamp(0, 100)) } else { None };
    let remaining = if battery == BatteryStatus::Discharging {
        PowerManager::RemainingDischargeTime()
            .ok()
            .map(|t| t.Duration / 10_000_000 / 60)
            // O Windows devolve um valor enorme quando ainda está estimando.
            .filter(|m| *m > 0 && *m < 60 * 48)
    } else {
        None
    };
    PowerState {
        available: true,
        has_battery,
        percent,
        battery: match battery {
            BatteryStatus::Charging => "charging",
            BatteryStatus::Discharging => "discharging",
            BatteryStatus::Idle => "idle",
            _ => "none",
        }
        .into(),
        plugged: supply == PowerSupplyStatus::Adequate || supply == PowerSupplyStatus::Inadequate,
        supply: match supply {
            PowerSupplyStatus::Adequate => "adequate",
            PowerSupplyStatus::Inadequate => "inadequate",
            _ => "none",
        }
        .into(),
        remaining_discharge_min: remaining,
        energy_saver: PowerManager::EnergySaverStatus().map(|s| s == EnergySaverStatus::On).unwrap_or(false),
    }
}

#[cfg(not(windows))]
pub fn read() -> PowerState {
    PowerState { available: false, battery: "none".into(), supply: "none".into(), ..Default::default() }
}

#[cfg(windows)]
pub fn start(app: &AppHandle) {
    use windows::core::IInspectable;
    use windows::Foundation::EventHandler;
    use windows::System::Power::PowerManager;

    let make = |app: AppHandle| {
        EventHandler::<IInspectable>::new(move |_, _| {
            let _ = app.emit("power://state", read());
            Ok(())
        })
    };
    // Os tokens não são removidos: as assinaturas vivem enquanto o processo viver.
    let results = [
        PowerManager::BatteryStatusChanged(&make(app.clone())),
        PowerManager::PowerSupplyStatusChanged(&make(app.clone())),
        PowerManager::RemainingChargePercentChanged(&make(app.clone())),
        PowerManager::EnergySaverStatusChanged(&make(app.clone())),
    ];
    let failed = results.iter().filter(|r| r.is_err()).count();
    if failed > 0 {
        log::warn!(target: "power", "{failed} assinaturas de energia falharam");
    }
}

#[cfg(not(windows))]
pub fn start(_app: &AppHandle) {}

#[tauri::command]
pub fn power_state() -> PowerState {
    read()
}
