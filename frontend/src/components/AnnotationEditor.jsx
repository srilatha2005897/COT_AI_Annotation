import { useCallback, useEffect, useRef, useState } from "react";
import { CLASS_OPTIONS } from "../lib/yoloClasses";
import "../styles/shared.css";

export function AnnotationEditor({
  imageId,
  width,
  height,
  boxes = [],
  setBoxes,
  onSave,
  saving,
  error,
  setError,
  readOnly = false,
}) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const interactionRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [newClass, setNewClass] = useState("car");
  const [newConfidence, setNewConfidence] = useState(1);
  const [converting, setConverting] = useState(false);

  // Undo history. We snapshot the box list just before each edit so
  // Ctrl/Cmd+Z (or the Undo button) can step back through changes.
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);

  const pushHistory = useCallback(() => {
    const stack = historyRef.current;
    if (stack[stack.length - 1] === boxes) {
      return;
    }
    stack.push(boxes);
    if (stack.length > 50) {
      stack.shift();
    }
    setCanUndo(true);
  }, [boxes]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (previous) {
      setBoxes(previous);
      setSelected(null);
    }
    setCanUndo(historyRef.current.length > 0);
  }, [setBoxes]);

  const clampBox = useCallback(
    (box) => {
      const safeWidth = Number(width) || 1;
      const safeHeight = Number(height) || 1;
      const x = Math.max(0, Math.min(Number(box.x) || 0, safeWidth - 1));
      const y = Math.max(0, Math.min(Number(box.y) || 0, safeHeight - 1));
      const boxWidth = Math.max(4, Math.min(Number(box.width) || 4, safeWidth - x));
      const boxHeight = Math.max(4, Math.min(Number(box.height) || 4, safeHeight - y));

      return {
        ...box,
        x,
        y,
        width: boxWidth,
        height: boxHeight,
      };
    },
    [width, height]
  );

  const handleConvertToText = () => {
    if (!boxes.length) {
      setError?.("No annotation boxes available.");
      return;
    }

    if (!width || !height) {
      setError?.("Image dimensions are missing.");
      return;
    }

    try {
      setConverting(true);
      setError?.("");
      const classMap = {};

      boxes.forEach((box) => {
        if (classMap[box.class_name] === undefined) {
          classMap[box.class_name] = Object.keys(classMap).length;
        }
      });

      const yoloText = boxes
        .map((box) => {
          const classId = classMap[box.class_name];
          const centerX = (Number(box.x) + Number(box.width) / 2) / Number(width);
          const centerY = (Number(box.y) + Number(box.height) / 2) / Number(height);
          const normalizedWidth = Number(box.width) / Number(width);
          const normalizedHeight = Number(box.height) / Number(height);

          return [
            classId,
            centerX.toFixed(6),
            centerY.toFixed(6),
            normalizedWidth.toFixed(6),
            normalizedHeight.toFixed(6),
          ].join(" ");
        })
        .join("\n");

      const blob = new Blob([yoloText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `image_${imageId}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError?.(err.message || "Could not convert annotations.");
    } finally {
      setConverting(false);
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imgRef.current;

    if (!canvas || !image || !image.complete || !image.naturalWidth) {
      return;
    }

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    boxes.forEach((box, index) => {
      const active = selected === index;
      ctx.strokeStyle = active ? "#c45c26" : "#0f6b4c";
      ctx.lineWidth = active ? 4 : 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      const confidence = Math.round((box.confidence ?? 1) * 100);
      const label = `${box.class_name} ${confidence}%`;
      ctx.font = "16px Arial, sans-serif";
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = active ? "#c45c26" : "#0f6b4c";
      ctx.fillRect(box.x, Math.max(0, box.y - 24), textWidth + 10, 24);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, box.x + 5, Math.max(16, box.y - 7));

      if (active) {
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#c45c26";
        ctx.lineWidth = 2;
        ctx.fillRect(box.x + box.width - 10, box.y + box.height - 10, 10, 10);
        ctx.strokeRect(box.x + box.width - 10, box.y + box.height - 10, 10, 10);
      }
    });
  }, [boxes, selected]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }

      const meta = event.metaKey || event.ctrlKey;

      if (readOnly) return;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (meta && event.key === "Enter") {
        event.preventDefault();
        onSave?.();
        return;
      }

      if (event.key === "Escape") {
        setSelected(null);
        return;
      }

      if (selected === null) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        pushHistory();
        setBoxes((previous) => previous.filter((_, i) => i !== selected));
        setSelected(null);
        return;
      }

      const nudges = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const nudge = nudges[event.key];
      if (nudge) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        setBoxes((previous) =>
          previous.map((box, i) =>
            i === selected
              ? clampBox({
                  ...box,
                  x: Number(box.x) + nudge[0] * step,
                  y: Number(box.y) + nudge[1] * step,
                  source: "human",
                })
              : box
          )
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, undo, pushHistory, onSave, setBoxes, clampBox, readOnly]);

  const toImageCoords = (event) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect = canvas.getBoundingClientRect();
    const clamp = (value, max) => Math.max(0, Math.min(Number(max), value));
    return {
      x: clamp((event.clientX - rect.left) * (canvas.width / rect.width), width),
      y: clamp((event.clientY - rect.top) * (canvas.height / rect.height), height),
    };
  };

  // Walk backwards so the box drawn last (on top) wins.
  const hitTest = (point) => {
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index];
      if (
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height
      ) {
        return index;
      }
    }

    return -1;
  };

  const onPointerDown = (event) => {
    if (readOnly) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = toImageCoords(event);
    const hit = hitTest(point);
    pushHistory();

    if (hit >= 0) {
      setSelected(hit);
      const box = boxes[hit];

      // Grabbing near the bottom-right corner resizes, anywhere else moves.
      const nearCorner =
        point.x >= box.x + box.width - 18 && point.y >= box.y + box.height - 18;
      interactionRef.current = {
        type: nearCorner ? "resize" : "move",
        index: hit,
        start: point,
        box: { ...box },
      };
      return;
    }

    interactionRef.current = { type: "draw", start: point };
    setSelected(null);
  };

  const onPointerMove = (event) => {
    const action = interactionRef.current;
    if (!action || (action.type !== "move" && action.type !== "resize")) return;
    const point = toImageCoords(event);

    setBoxes((previous) =>
      previous.map((box, index) => {
        if (index !== action.index) {
          return box;
        }

        if (action.type === "move") {
          return clampBox({
            ...box,
            x: action.box.x + point.x - action.start.x,
            y: action.box.y + point.y - action.start.y,
            source: "human",
          });
        }

        return clampBox({
          ...box,
          width: Math.max(4, action.box.width + point.x - action.start.x),
          height: Math.max(4, action.box.height + point.y - action.start.y),
          source: "human",
        });
      })
    );
  };

  const onPointerUp = (event) => {
    const action = interactionRef.current;
    if (!action) return;
    const point = toImageCoords(event);
    interactionRef.current = null;
    if (action.type !== "draw") return;

    const x = Math.min(action.start.x, point.x);
    const y = Math.min(action.start.y, point.y);
    const boxWidth = Math.abs(point.x - action.start.x);
    const boxHeight = Math.abs(point.y - action.start.y);

    if (boxWidth >= 8 && boxHeight >= 8) {
      setBoxes((previous) => [
        ...previous,
        {
          class_name: newClass,
          confidence: newConfidence,
          x,
          y,
          width: boxWidth,
          height: boxHeight,
          source: "human",
        },
      ]);
    }
  };

  const updateSelected = (patch) => {
    if (selected === null) return;
    pushHistory();

    setBoxes((previous) =>
      previous.map((box, index) =>
        index === selected
          ? clampBox({
              ...box,
              ...patch,
              source: "human",
            })
          : box
      )
    );
  };

  const deleteSelected = () => {
    if (selected === null) return;
    pushHistory();
    setBoxes((previous) => previous.filter((_, index) => index !== selected));
    setSelected(null);
  };

  return (
    <div className="annotation-editor">
      <div className="annotation-canvas-panel">
        <div className="editor-toolbar">
          <div>
            <span className="section-eyebrow">ANNOTATION EDITOR</span>

            <strong>Image #{imageId}</strong>
          </div>

          <div className="editor-toolbar-right">
            <button
              type="button"
              className="toolbar-button"
              onClick={undo}
              disabled={!canUndo || readOnly}
              title="Undo (Ctrl/Cmd+Z)"
            >
              ↶ Undo
            </button>
            <span>{boxes.length} boxes</span>
          </div>
        </div>

        <div className="editor-help">
          <span>
            Drag in empty space to draw a box. Drag a box to move it, or its bottom-right
            handle to resize.
          </span>
          <span className="editor-shortcuts">
            <kbd>Del</kbd> remove · <kbd>←↑↓→</kbd> nudge · <kbd>Esc</kbd> deselect ·
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save
          </span>
        </div>

        <div className="canvas-wrap">
          <img
            ref={imgRef}
            src={`/api/files/original/${imageId}`}
            alt="Original"
            hidden
            crossOrigin="anonymous"
            onLoad={draw}
          />

          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              interactionRef.current = null;
            }}
          />
        </div>
      </div>

      <aside className="annotation-sidebar">
        <div className="annotation-sidebar-header">
          <span className="section-eyebrow">CONTROLS</span>

          <h3>Manual annotation</h3>

          <p>
            {boxes.length} boxes · {width} × {height}
          </p>
        </div>

        <div className="control-group">
          <label>New box class</label>

          <select disabled={readOnly} value={newClass} onChange={(event) => setNewClass(event.target.value)}>
            {CLASS_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>New box confidence</label>

          <input
            type="number"
            min="0"
            disabled={readOnly}
            max="100"
            value={Math.round(newConfidence * 100)}
            onChange={(event) =>
              setNewConfidence(
                Math.max(0, Math.min(100, Number(event.target.value))) / 100
              )
            }
          />
        </div>

        {selected !== null && boxes[selected] && (
          <div className="selected-box-editor">
            <div className="selected-box-header">Selected box #{selected + 1}</div>

            <div className="control-group">
              <label>Class</label>

              <select
                disabled={readOnly}
                value={boxes[selected].class_name}
                onChange={(event) =>
                  updateSelected({
                    class_name: event.target.value,
                  })
                }
              >
                {CLASS_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label>Confidence %</label>

              <input
                type="number"
                min="0"
                disabled={readOnly}
                max="100"
                value={Math.round((boxes[selected].confidence ?? 1) * 100)}
                onChange={(event) =>
                  updateSelected({
                    confidence:
                      Math.max(0, Math.min(100, Number(event.target.value))) / 100,
                  })
                }
              />
            </div>

            <div className="coordinate-grid">
              {[
                ["X", "x"],
                ["Y", "y"],
                ["Width", "width"],
                ["Height", "height"],
              ].map(([label, key]) => (
                <label key={key}>
                  {label}

                  <input
                    disabled={readOnly}
                    type="number"
                    min={key === "width" || key === "height" ? 4 : undefined}
                    value={Math.round(boxes[selected][key])}
                    onChange={(event) =>
                      updateSelected({
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>

            {!readOnly && <button type="button" className="danger-button" onClick={deleteSelected}>
              Delete selected box
            </button>}
          </div>
        )}

        <div className="box-list">
          {boxes.map((box, index) => (
            <button
              type="button"
              key={index}
              className={`box-list-item ${selected === index ? "selected" : ""}`}
              onClick={() => !readOnly && setSelected(index)}
            >
              <span className="box-number">{index + 1}</span>

              <span className="box-details">
                <strong>{box.class_name}</strong>

                <small>
                  {Math.round((box.confidence ?? 1) * 100)}% · {box.source || "ai"}
                </small>
              </span>

              <span>›</span>
            </button>
          ))}
        </div>

        <div className="annotation-actions">
          <button
            type="button"
            className="primary-button"
            disabled={saving || readOnly}
            onClick={onSave}
          >
            {saving ? "Saving..." : "Save annotations"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={readOnly || converting || !boxes.length}
            onClick={handleConvertToText}
          >
            {converting ? "Converting..." : "Convert to YOLO Text"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={readOnly || !boxes.length}
            onClick={() => {
              if (!window.confirm("Remove all boxes on this image?")) return;
              pushHistory();
              setBoxes([]);
              setSelected(null);
            }}
          >
            Delete all
          </button>
        </div>

        {error && <div className="error">{error}</div>}
      </aside>
    </div>
  );
}

export default AnnotationEditor;
