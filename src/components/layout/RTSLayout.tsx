import { ResourceBar } from "../resources/ResourceBar";
import { Minimap } from "../minimap/Minimap";
import { MainView } from "../mainview/MainView";
import { CommandPanel } from "../command/CommandPanel";
import { UnitPortraits } from "../units/UnitPortraits";
import { SelectionBox } from "./SelectionBox";
import { useSelection } from "../../hooks";

export function RTSLayout() {
  const { handleMouseDown, handleMouseMove, handleMouseUp, getSelectionBox } =
    useSelection();

  const selectionBox = getSelectionBox();

  return (
    <div
      className="rts-layout"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <ResourceBar />
      <Minimap />
      <MainView />
      <CommandPanel />
      <UnitPortraits />

      {selectionBox && (
        <SelectionBox
          left={selectionBox.left}
          top={selectionBox.top}
          width={selectionBox.width}
          height={selectionBox.height}
        />
      )}
    </div>
  );
}
