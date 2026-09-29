# Townfall save format

Townfall (Steam app 1636440) is built on Unreal Engine 5.6.1. Its saves are
standard, **uncompressed and unencrypted** UE `SaveGame` files (GVAS). There is
no checksum.

Location: `%LOCALAPPDATA%\Townfall\Saved\SaveGames\`

| File                  | Contents                                          |
|-----------------------|---------------------------------------------------|
| `SaveGameSlotN.sav`   | manual save slots                                 |
| `SaveGame.sav`        | latest / continue save                            |
| `ProfileData.sav`     | lifetime `Total_*` stats, options, tutorials seen |
| `DisplaySettings.sav` | graphics and display settings                     |

## Container (GVAS)

```
u32    magic "GVAS"
i32    SaveGameFileVersion = 3
i32    PackageFileUEVersion (UE4) = 522
i32    PackageFileUEVersion (UE5) = 1017
u16×3  engine 5.6.1, u32 changelist 0, FString branch "UE5"
i32    custom version format = 3
i32    count = 88, then count × (guid[16], i32 version)
FString save class = "/Script/NCSaveGameCore.SaveData"
u8     EClassSerializationControlExtension (UE ≥ 5.4) = 0
...    tagged properties, terminated by FString "None"
u32    0 (trailer)
```

Tagged properties use the UE 5.4+ layout, which keeps the complete type name:

```
FString Name
TypeName   = FString name, i32 innerCount, innerCount × TypeName   (recursive)
i32     Size
u8      Flags   0x01 ArrayIndex, 0x02 Guid, 0x04 Extensions, 0x10 bool value
[optional fields selected by Flags]
Size bytes of value
```

A bool's value is stored in flag bit 0x10 and its `Size` is 0. A map value is
`i32 removedCount (0)`, `i32 count`, then key/value pairs.

## `SaveData` object

The save class holds only a handful of properties. All game state lives in four
string-keyed maps:

| Property            | Type                                         |
|---------------------|----------------------------------------------|
| `SaveDateTimeTicks` | Int64 (.NET ticks, 100 ns since 0001-01-01)  |
| `TotalTimePlayed`   | Double, seconds (game saves only)            |
| `SavedBoolMap`      | Map<Name, Bool>                              |
| `SavedIntMap`       | Map<Name, Int>                               |
| `SavedFloatMap`     | Map<Name, Float>                             |
| `SavedStringMap`    | Map<Name, Str>                               |

Keys are flat strings. Each game system prefixes its own keys:

- `TFPC_`: player character. `TFPC_Health`, `TFPC_NumEnemiesKilled`,
  `TFPC_PlayerCharacterType` (Simon/Zoe/Richard), `TFPC_Torch_On`.
- `TFPC_TFIC_[Temp_]InventoryItemN_*`: inventory, see below.
- `TFPC_DiscoveriesFound_N`: discoveries, as item ids.
- `TFPCtrl_`: player controller. Examined items, SimonOS combos.
- `TFMM_MissionM_*`: mission manager. `_SaveState`
  (NotStarted/Active/Completed), `_ObjectiveO_State`, `_CurrentObjectiveID`,
  `_ActionEventX_Expired`, `_ActionEventX_TimesEventFired`.
- `TCM_`: phone calls.
  `TCM_OutgoingCallN_IsActive/InDirectory/HasBeenCalled`.
- `RWypMgr_`: radio waypoints.
- `CPM_CurrentLoadIn*`: spawn location and rotation.
- `TownfallDoorMgr_`: doors. `…_<actor>_bIsLocked/bIsOpen/bIsDestroyed`.
- `PkpMgr_`, `PMapMgr_`, `HndRMgr_`, `SaveHelper_`: world object state
  (pickups, map, handlers).
- `TFDL_DataLayer_*`: loaded world-partition data layers.
- `Deaths_`, `TimePlayed_`, `Lowest*Difficulty_`: playthrough bookkeeping.

### Inventory

Item slot `N` (contiguous from 0) is spread across the maps:

| Key suffix     | Map    | Meaning                                    |
|----------------|--------|--------------------------------------------|
| `_ID`          | String | item id, **hex**, from `ItemDatabase.xml`  |
| `_NoHeld`      | Int    | count                                      |
| `_AmmoCount`   | Int    | loaded ammo (guns)                         |
| `_Durability`  | Float  | melee weapon durability                    |
| `_MeshVariant` | Int    | visual variant (bottles)                   |

`TFPC_TFIC_EquippedItem` / `PrevEquippedItem` hold item ids. The `Temp_`
inventory is a second inventory the game uses when switching characters.
`TFIC_TempInventoryLastCharacter` records which character used it last.

### IDs

Item, mission and objective IDs are hex strings. They come from design XMLs
that ship unencrypted in `Townfall/Content/Paks/pakchunk0-Windows.pak` under
`Townfall/Content/Townfall/Design/`:

- `ItemDatabase.xml`: 335 items (`itemID`, `name`, `type`, …)
- `Missions/*.xml`: `MissionID`, `MissionName`, objectives (`ReferenceID`,
  `ObjectiveName`)

To regenerate the editor's `docs/data/*.json`:

```sh
repak unpack -o ext -i 'Townfall/Content/Townfall/Design/**' \
    "<game>/Townfall/Content/Paks/pakchunk0-Windows.pak"
python3 tools/extract_gamedata.py ext/Townfall/Content/Townfall/Design
```

Display names (`nameLineID`) point into the Dialoc localisation database,
which is cooked into the IoStore containers. The editor does not decode it yet
and shows the internal names instead.
