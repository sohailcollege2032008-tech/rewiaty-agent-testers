import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { OnboardingSampleCard } from '@/components/onboarding-sample-card';
import type {
  OnboardingSampleResponse,
  StyleDnaCandidate,
  SuggestedThemeCandidate,
} from '@/types/upload-contract';

const THEMES: SuggestedThemeCandidate[] = [
  {
    theme_id: 'th_warm',
    name_ar: 'ورق دافئ',
    name_en: 'Warm paper',
    background: '#F3EDE2',
    surface: '#FFFDF8',
    text: '#231F1A',
    accent: '#9E3E2F',
    rationale_ar: 'جو دافئ زي ورق قديم، مريح للقراية الطويلة.',
  },
  {
    theme_id: 'th_night',
    name_ar: 'ليل هادي',
    name_en: 'Quiet night',
    background: '#1C1B19',
    surface: '#26241F',
    text: '#EDE6D8',
    accent: '#C9A227',
    rationale_ar: 'خلفية غامقة بتريّح العين في القراية بالليل.',
  },
  {
    theme_id: 'th_olive',
    name_ar: 'زيتوني',
    name_en: 'Olive',
    background: '#E7E7DC',
    surface: '#F6F6EC',
    text: '#242A1F',
    accent: '#5C6B44',
    rationale_ar: 'أخضر ترابي هادي، قريب من ألوان الطبيعة.',
  },
];

const STYLES: StyleDnaCandidate[] = [
  {
    style_id: 'st_ink',
    name_ar: 'حبر مائي',
    name_en: 'Ink wash',
    prompt_prefix: 'ink wash illustration, warm sepia, soft edges',
    palette: ['#8C6A4A', '#C9A98A', '#4A3B2C', '#E8DCCB'],
    mood_tags: ['هادئ', 'ترابي'],
  },
  {
    style_id: 'st_line',
    name_ar: 'خطوط رقيقة',
    name_en: 'Fine line',
    prompt_prefix: 'fine line drawing, muted palette, editorial',
    palette: ['#2F5356', '#D9C5A3', '#F5EFE4'],
    mood_tags: ['دقيق', 'أنيق'],
  },
  {
    style_id: 'st_woodcut',
    name_ar: 'حفر خشب',
    name_en: 'Woodcut',
    prompt_prefix: 'woodcut print, high contrast, carved texture',
    palette: ['#1F1B16', '#7B2D21', '#E2CBA8'],
    mood_tags: ['حاد', 'درامي'],
  },
];

const SAMPLE: OnboardingSampleResponse = {
  book_id: 'book_9',
  themes: THEMES,
  styles: STYLES,
  sample_cost_usd: 0.02,
};

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

describe('OnboardingSampleCard (F42)', () => {
  it('renders the 3 suggested themes, the 3 Style DNA candidates and a live preview', async () => {
    const screen = await render(<OnboardingSampleCard sample={SAMPLE} onConfirm={jest.fn()} />);

    expect(screen.getByText('اختر جو القراءة')).toBeTruthy();
    expect(screen.getByText('اختر أسلوب الرسم (Style DNA)')).toBeTruthy();

    for (const theme of THEMES) {
      expect(screen.getByTestId(`onboarding-theme-${theme.theme_id}`)).toBeTruthy();
    }
    for (const style of STYLES) {
      expect(screen.getByTestId(`onboarding-style-${style.style_id}`)).toBeTruthy();
    }

    const preview = screen.getByTestId('onboarding-theme-preview');
    expect(flatStyle(preview).backgroundColor).toBe(THEMES[0]!.background);
    expect(flatStyle(screen.getByTestId('onboarding-theme-preview-surface')).backgroundColor).toBe(
      THEMES[0]!.surface,
    );
    expect(flatStyle(screen.getByTestId('onboarding-theme-preview-text')).color).toBe(THEMES[0]!.text);
    expect(screen.getByTestId('onboarding-theme-preview-name-ar')).toHaveTextContent('ورق دافئ');
    expect(screen.getByTestId('onboarding-theme-preview-rationale')).toHaveTextContent(
      /جو دافئ زي ورق قديم/,
    );
    expect(screen.getByTestId('onboarding-theme-th_warm').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('onboarding-sample-cost')).toHaveTextContent(/\$0\.02/);
  });

  it('switches the live preview colors when another theme is tapped', async () => {
    const screen = await render(<OnboardingSampleCard sample={SAMPLE} onConfirm={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('onboarding-theme-th_night'));

    expect(flatStyle(screen.getByTestId('onboarding-theme-preview')).backgroundColor).toBe(
      THEMES[1]!.background,
    );
    expect(
      flatStyle(screen.getByTestId('onboarding-theme-preview-surface')).backgroundColor,
    ).toBe(THEMES[1]!.surface);
    expect(flatStyle(screen.getByTestId('onboarding-theme-preview-text')).color).toBe(
      THEMES[1]!.text,
    );
    expect(screen.getByTestId('onboarding-theme-preview-name-ar')).toHaveTextContent('ليل هادي');
    expect(screen.getByTestId('onboarding-theme-preview-rationale')).toHaveTextContent(
      /خلفية غامقة/,
    );
    expect(screen.getByTestId('onboarding-theme-th_night').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('onboarding-theme-th_warm').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('selects among the 3 illustration styles and marks only one as selected', async () => {
    const screen = await render(<OnboardingSampleCard sample={SAMPLE} onConfirm={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('onboarding-style-st_woodcut'));

    expect(screen.getByTestId('onboarding-style-st_woodcut').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('onboarding-style-st_ink').props.accessibilityState).toEqual({
      selected: false,
    });

    // Palette swatches and the prompt prefix are previewed for every candidate.
    expect(screen.getByTestId('onboarding-style-swatch-st_woodcut-0')).toBeTruthy();
    expect(screen.getByTestId('onboarding-style-prompt-st_woodcut')).toHaveTextContent(
      /woodcut print/,
    );
    expect(screen.getByText('درامي')).toBeTruthy();
  });

  it('submits the chosen theme, style and custom prompt prefix', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<OnboardingSampleCard sample={SAMPLE} onConfirm={onConfirm} />);

    await fireEvent.press(screen.getByTestId('onboarding-theme-th_night'));
    await fireEvent.press(screen.getByTestId('onboarding-style-st_ink'));
    await fireEvent.press(screen.getByTestId('onboarding-custom-prompt-toggle'));

    const input = screen.getByTestId('onboarding-custom-prompt-input');
    await fireEvent.changeText(input, '  حبر مائي دافئ بلمسة ترابية  ');
    expect(screen.getByTestId('onboarding-effective-prefix')).toHaveTextContent(
      'حبر مائي دافئ بلمسة ترابية',
    );

    await fireEvent.press(screen.getByTestId('onboarding-confirm-btn'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      selected_theme_id: 'th_night',
      selected_style_id: 'st_ink',
      custom_prompt_prefix: 'حبر مائي دافئ بلمسة ترابية',
    });
  });

  it('omits the custom prompt prefix when the user never typed one', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<OnboardingSampleCard sample={SAMPLE} onConfirm={onConfirm} />);

    await fireEvent.press(screen.getByTestId('onboarding-confirm-btn'));

    expect(onConfirm).toHaveBeenCalledWith({
      selected_theme_id: 'th_warm',
      selected_style_id: 'st_ink',
      custom_prompt_prefix: undefined,
    });
  });

  it('hides the sample cost row when the sample was free', async () => {
    const screen = await render(
      <OnboardingSampleCard sample={{ ...SAMPLE, sample_cost_usd: 0 }} onConfirm={jest.fn()} />,
    );

    expect(screen.queryByTestId('onboarding-sample-cost')).toBeNull();
  });
});
