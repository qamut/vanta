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

/// Linux e macOS: a bateria vem do sysfs/UPower ou do IOKit (crate starship-battery).
#[cfg(not(windows))]
pub fn read() -> PowerState {
    use starship_battery::State;
    let none = PowerState { available: false, battery: "none".into(), supply: "none".into(), ..Default::default() };
    let Ok(manager) = starship_battery::Manager::new() else { return none };
    let first = manager.batteries().ok().and_then(|mut it| it.find_map(|b| b.ok()));
    let Some(b) = first else {
        // desktop: sem bateria, ligado na tomada
        return PowerState { available: true, has_battery: false, battery: "none".into(), plugged: true, supply: "adequate".into(), ..Default::default() };
    };
    let state = b.state();
    let battery = match state {
        State::Charging => "charging",
        State::Discharging => "discharging",
        _ => "idle",
    };
    let plugged = state != State::Discharging;
    PowerState {
        available: true,
        has_battery: true,
        percent: Some(((b.state_of_charge().value * 100.0).round() as i32).clamp(0, 100)),
        battery: battery.into(),
        plugged,
        supply: if plugged { "adequate".into() } else { "none".into() },
        remaining_discharge_min: if state == State::Discharging { b.time_to_empty().map(|t| (t.value / 60.0) as i64).filter(|m| *m > 0 && *m < 60 * 48) } else { None },
        energy_saver: false,
    }
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

/// Sem eventos de energia fora do Windows: relê a cada 30 s e avisa quando muda.
#[cfg(not(windows))]
pub fn start(app: &AppHandle) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("vanta-power".into()).spawn(move || {
        let mut last = read();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            let now = read();
            if now != last {
                let _ = app.emit("power://state", now.clone());
                last = now;
            }
        }
    });
}

#[tauri::command]
pub fn power_state() -> PowerState {
    read()
}
