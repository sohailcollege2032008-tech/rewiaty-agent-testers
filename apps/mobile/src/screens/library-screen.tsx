import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCard } from '@/components/book-card';
import { deleteBookBundle, ensureSampleBookSeeded } from '@/storage/bundle';
import { listBooks } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
import type { BookLibraryRecord } from '@/types/reader';

export function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [books, setBooks] = useState<BookLibraryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const seededOnceRef = useRef(false);

  const refreshBooks = useCallback(async () => {
    try {
      setErrorMsg(null);
      if (!seededOnceRef.current) {
        seededOnceRef.current = true;
        await ensureSampleBookSeeded();
      }
      const rows = await listBooks();
      setBooks(rows);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذّر تحميل المكتبة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshBooks();
    }, [refreshBooks]),
  );

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const imported = await pickAndImportBook();
      if (imported) {
        const rows = await listBooks();
        setBooks(rows);
      }
    } catch (err) {
      Alert.alert(
        'تعذّر الاستيراد',
        err instanceof Error ? err.message : 'حدث خطأ أثناء استيراد الملف.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleOpenBook = (book: BookLibraryRecord) => {
    router.push({ pathname: '/reader/[id]', params: { id: book.id } });
  };

  const handleLongPressBook = (book: BookLibraryRecord) => {
    Alert.alert(
      'حذف الكتاب',
      `هل تريد حذف «${book.title}» من المكتبة؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteBookBundle(book.id);
                const rows = await listBooks();
                setBooks(rows);
              } catch (err) {
                Alert.alert(
                  'تعذّر الحذف',
                  err instanceof Error ? err.message : 'حدث خطأ أثناء حذف الكتاب.',
                );
              }
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>روايتي</Text>
          <Text style={styles.headerSubtitle}>مكتبتك الشخصية</Text>
        </View>

        <Pressable
          testID="import-book-button"
          onPress={() => void handleImport()}
          disabled={importing}
          style={({ pressed }) => [
            styles.importBtn,
            pressed && styles.importBtnPressed,
            importing && styles.importBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="استيراد كتاب جديد"
        >
          <Text style={styles.importBtnText}>{importing ? 'جاري الاستيراد...' : '+ استيراد'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#8B5A2B" />
          <Text style={styles.stateText}>جاري تحضير المكتبة...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText} selectable>
            {errorMsg}
          </Text>
          <Pressable onPress={() => void refreshBooks()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="library-book-list"
          data={books}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 12 },
          ]}
          renderItem={({ item }) => (
            <BookCard
              book={item}
              onPress={handleOpenBook}
              onLongPress={handleLongPressBook}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyOrnament}>✦</Text>
              <Text style={styles.emptyTitle}>المكتبة فارغة</Text>
              <Text style={styles.emptyHint}>
                اضغط «+ استيراد» لإضافة رواية بصيغة .md أو .txt
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5DDD0',
    backgroundColor: '#FAF8F5',
  },
  headerTextWrap: {
    gap: 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#24211D',
    textAlign: 'right',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6E675F',
    textAlign: 'right',
  },
  importBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#8B5A2B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtnPressed: {
    opacity: 0.84,
  },
  importBtnDisabled: {
    opacity: 0.6,
  },
  importBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFDF9',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  stateText: {
    fontSize: 15,
    color: '#6E675F',
  },
  errorText: {
    fontSize: 15,
    color: '#991B1B',
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#8B5A2B',
    justifyContent: 'center',
  },
  retryBtnText: {
    color: '#FFFDF9',
    fontWeight: '700',
    fontSize: 14,
  },
  emptyState: {
    paddingVertical: 72,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyOrnament: {
    fontSize: 24,
    color: '#8B5A2B',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#24211D',
  },
  emptyHint: {
    fontSize: 14,
    color: '#6E675F',
    textAlign: 'center',
    lineHeight: 22,
  },
});
