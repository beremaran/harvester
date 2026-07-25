import {
    createRenderRequest,
    type RenderCommand,
    type RenderRequest,
    type RenderResult
} from "../domain/rendering.js";

export interface PageRenderer {
    render(request: RenderRequest): Promise<RenderResult>;
}

export interface RenderPageUseCase {
    execute(command: RenderCommand): Promise<RenderResult>;
}

export class RenderPage implements RenderPageUseCase {
    constructor(private readonly renderer: PageRenderer) {}

    execute(command: RenderCommand): Promise<RenderResult> {
        return this.renderer.render(createRenderRequest(command));
    }
}
