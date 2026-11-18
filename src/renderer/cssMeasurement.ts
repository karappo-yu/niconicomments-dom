import { CanvasRenderer, clampCanvasSize } from "./canvas";

/** Text measurement for DOM comments; viewport changes never allocate pixels. */
class CSSMeasurementRenderer extends CanvasRenderer {
  public override readonly rendererName = "CSSMeasurementRenderer";
  private viewportSize = { width: 0, height: 0 };

  constructor(size: { width: number; height: number }) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    super(canvas);
    this.setSize(size.width, size.height);
  }

  override setSize(width: number, height: number) {
    this.viewportSize = clampCanvasSize(width, height);
  }

  override getSize() {
    return { ...this.viewportSize };
  }

  override destroy() {
    super.destroy();
    this.canvas.width = this.canvas.height = 0;
  }
}

export { CSSMeasurementRenderer };
