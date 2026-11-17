/** Example board contents, read from the sections library through the in-process API. */
import { api } from '~/server/api';
import type { SectionCard } from '~/server/api/v1/schemas/common';
import type { ExampleBoard } from './content';

export async function loadExampleItems(board: ExampleBoard, limit = 12): Promise<SectionCard[]> {
  try {
    const { data } = await api.listSections({ ...board.query, limit });
    return data.items;
  } catch (err) {
    console.error('example board failed', board.id, err);
    return [];
  }
}
